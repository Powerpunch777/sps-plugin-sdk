import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const DEVELOPMENT_BUILD_SCHEMA_VERSION = "development-build/v1";

export const DEFAULT_DEVELOPMENT_BUILD_LIMITS = Object.freeze({
  maxFiles: 10_000,
  maxTotalBytes: 256 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
});

const EXCLUDED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);
const EXCLUDED_FILE = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|.*\.(?:log|tmp|temp|swp|swo|bak|pem|key|p12|pfx)|.*\.(?:tmp|temp)-[^/]+|\.~lock\.[^/]+|#[^/]+#|~[^/]*|credentials(?:\.[^/]+)?|id_(?:rsa|ed25519))$/i;

class DevelopmentBuildError extends Error {
  constructor(code, phase, message) {
    super(message);
    this.code = code;
    this.phase = phase;
  }
}

function compareName(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeLimits(limits = {}) {
  const result = { ...DEFAULT_DEVELOPMENT_BUILD_LIMITS, ...limits };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Development build limit ${key} must be a positive integer.`);
    }
  }
  return result;
}

async function resolvePluginRoot(sourceDirectory) {
  if (typeof sourceDirectory !== "string" || sourceDirectory.trim().length === 0) {
    throw new DevelopmentBuildError("SOURCE_ROOT_INVALID", "source-fingerprint", "Plugin source directory is required.");
  }
  const requested = path.resolve(sourceDirectory);
  let requestedStats;
  try {
    requestedStats = await fs.lstat(requested);
  } catch {
    throw new DevelopmentBuildError("SOURCE_ROOT_INVALID", "source-fingerprint", "Plugin source directory is unavailable.");
  }
  if (!requestedStats.isDirectory() || requestedStats.isSymbolicLink()) {
    throw new DevelopmentBuildError("SOURCE_ROOT_INVALID", "source-fingerprint", "Plugin source directory must be a real directory.");
  }
  const root = await fs.realpath(requested);
  if (!isInside(path.dirname(root), root)) {
    throw new DevelopmentBuildError("SOURCE_ROOT_INVALID", "source-fingerprint", "Plugin source directory is invalid.");
  }
  return root;
}

async function collectSourceFiles(root, directory, files, counters, limits) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareName(left.name, right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = posixRelative(root, absolute);
    const stats = await fs.lstat(absolute);
    if (stats.isSymbolicLink()) {
      throw new DevelopmentBuildError("SOURCE_SYMLINK_REJECTED", "source-fingerprint", "Plugin source must not contain symbolic links or junctions.");
    }
    if (stats.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      await collectSourceFiles(root, absolute, files, counters, limits);
      continue;
    }
    if (!stats.isFile()) {
      throw new DevelopmentBuildError("SOURCE_ENTRY_UNSUPPORTED", "source-fingerprint", "Plugin source contains an unsupported filesystem entry.");
    }
    if (EXCLUDED_FILE.test(relative)) continue;
    if (stats.size > limits.maxFileBytes) {
      throw new DevelopmentBuildError("SOURCE_FILE_LIMIT", "source-fingerprint", "Plugin source exceeds the per-file size limit.");
    }
    counters.files += 1;
    counters.bytes += stats.size;
    if (counters.files > limits.maxFiles) {
      throw new DevelopmentBuildError("SOURCE_FILE_COUNT_LIMIT", "source-fingerprint", "Plugin source exceeds the file-count limit.");
    }
    if (counters.bytes > limits.maxTotalBytes) {
      throw new DevelopmentBuildError("SOURCE_TOTAL_SIZE_LIMIT", "source-fingerprint", "Plugin source exceeds the total-size limit.");
    }
    files.push({ absolute, relative, sizeBytes: stats.size });
  }
}

/**
 * Creates a deterministic SHA-256 fingerprint from the author-controlled
 * source tree. Generated outputs, dependencies, VCS data, temporary files,
 * logs, and plausible secret files are intentionally outside this contract.
 */
export async function fingerprintDevelopmentSource({ sourceDirectory, limits } = {}) {
  const root = await resolvePluginRoot(sourceDirectory);
  const files = [];
  const counters = { files: 0, bytes: 0 };
  await collectSourceFiles(root, root, files, counters, normalizeLimits(limits));
  const hash = createHash("sha256");
  hash.update("sps-development-source-v1\0");
  for (const file of files) {
    const bytes = await fs.readFile(file.absolute);
    hash.update(file.relative, "utf8");
    hash.update("\0");
    hash.update(String(bytes.length), "ascii");
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return Object.freeze({ fingerprint: hash.digest("hex"), fileCount: counters.files, totalBytes: counters.bytes });
}

async function readJson(pathname) {
  try {
    const stats = await fs.lstat(pathname);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024 * 1024) return null;
    return JSON.parse(await fs.readFile(pathname, "utf8"));
  } catch {
    return null;
  }
}

function safeUiEntry(packageManifest) {
  const candidate = packageManifest?.spsPlugin?.ui;
  if (candidate === undefined) return null;
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512 || candidate.includes("\0") || path.isAbsolute(candidate)) {
    throw new DevelopmentBuildError("UI_ENTRY_INVALID", "output-fingerprint", "Plugin UI entry declaration is invalid.");
  }
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized.startsWith("dist/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new DevelopmentBuildError("UI_ENTRY_INVALID", "output-fingerprint", "Plugin UI entry must be a safe file inside dist.");
  }
  return normalized;
}

async function fingerprintOutputFile(root, relative, required) {
  const absolute = path.resolve(root, relative);
  if (!isInside(root, absolute)) {
    throw new DevelopmentBuildError("OUTPUT_PATH_ESCAPE", "output-fingerprint", "Plugin build output must stay inside the plugin source directory.");
  }
  let stats;
  try {
    stats = await fs.lstat(absolute);
  } catch {
    if (!required) return null;
    throw new DevelopmentBuildError("OUTPUT_MISSING", "output-fingerprint", "Required plugin build output is missing.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new DevelopmentBuildError("OUTPUT_INVALID", "output-fingerprint", "Plugin build output must be a regular file.");
  }
  const real = await fs.realpath(absolute);
  if (!isInside(root, real)) {
    throw new DevelopmentBuildError("OUTPUT_PATH_ESCAPE", "output-fingerprint", "Plugin build output must not resolve outside the plugin source directory.");
  }
  return sha256(await fs.readFile(real));
}

/** Collects byte-level fingerprints for the outputs consumed by SPS. */
export async function fingerprintDevelopmentBuildOutputs({ sourceDirectory } = {}) {
  const root = await resolvePluginRoot(sourceDirectory);
  const packageManifest = await readJson(path.join(root, "package.json"));
  const declaredUi = safeUiEntry(packageManifest);
  const uiSha256 = declaredUi === null
    ? await fingerprintOutputFile(root, "dist/ui.js", false)
    : await fingerprintOutputFile(root, declaredUi, true);
  return Object.freeze({
    manifestSha256: await fingerprintOutputFile(root, "dist/manifest.js", true),
    workerSha256: await fingerprintOutputFile(root, "dist/worker.js", true),
    uiSha256,
  });
}

export function developmentBuildDiagnostic(error, fallback = {}) {
  if (error instanceof DevelopmentBuildError) {
    return Object.freeze({ code: error.code, phase: error.phase, message: error.message });
  }
  return Object.freeze({
    code: fallback.code ?? "COMMAND_FAILED",
    phase: fallback.phase ?? "command",
    message: fallback.message ?? "The development command did not complete.",
  });
}

/**
 * Creates the stable, machine-readable result exchanged between the public
 * authoring tools and SPS Developer Mode. It deliberately contains no local
 * path, command output, or credential material.
 */
export function createDevelopmentBuildResult({
  command,
  success,
  sourceFingerprint = null,
  manifestSha256 = null,
  workerSha256 = null,
  uiSha256 = null,
  startedAt,
  completedAt,
  diagnostics = [],
} = {}) {
  if (!["build", "validate", "test"].includes(command)) throw new TypeError("Development build command must be build, validate, or test.");
  if (typeof success !== "boolean") throw new TypeError("Development build success must be boolean.");
  if (typeof startedAt !== "string" || typeof completedAt !== "string") throw new TypeError("Development build timestamps are required.");
  return Object.freeze({
    schemaVersion: DEVELOPMENT_BUILD_SCHEMA_VERSION,
    command,
    success,
    sourceFingerprint,
    manifestSha256,
    workerSha256,
    uiSha256,
    startedAt,
    completedAt,
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze({
      code: String(diagnostic.code),
      phase: String(diagnostic.phase),
      message: String(diagnostic.message),
    }))),
  });
}
