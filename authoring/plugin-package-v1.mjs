import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import yazl from "yazl";
import { inspectPluginArchive } from "../registry/archive-inspector-v1.mjs";
import {
  canonicalizeRegistryIndex,
  canonicalizeReleaseRecord,
  isSafeRegistryRelativePath,
  validateRegistryIndex,
  validateRegistryPublisherProfile,
  validateReleaseRecord,
  verifyRegistryIndexSignature,
  verifyReleaseRecordSignature,
} from "../registry/release-record-v1.mjs";
import {
  calculateStaticCapabilitiesDigest,
  validateStaticPluginManifest,
} from "../registry/static-package-manifest-v1.mjs";

const MAX_AUTHORING_FILE_BYTES = 128 * 1024 * 1024;
const MAX_AUTHORING_TOTAL_BYTES = 512 * 1024 * 1024;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]{2,127}$/;
const PUBLISHER_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);
const SENSITIVE_FILE = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|credentials(?:\.json)?|.*\.(?:pem|key|p12|pfx))$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function posixRelative(root, value) {
  return path.relative(root, value).split(path.sep).join("/");
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeOutputPath(root, outputPath) {
  const target = path.resolve(outputPath);
  if (target === root || isPathInside(root, target)) {
    throw new Error("Plugin archive output must be outside the plugin source directory.");
  }
  return target;
}

async function readJson(filePath, label) {
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024 * 1024) {
    throw new Error(`${label} must be a regular JSON file smaller than 1 MiB.`);
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function collectPluginFiles(root, directory = root, files = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = posixRelative(root, absolute);
    const stats = await fs.lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error(`Plugin package cannot contain a symbolic link: ${relative}.`);
    if (stats.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      await collectPluginFiles(root, absolute, files);
      continue;
    }
    if (!stats.isFile()) throw new Error(`Plugin package contains an unsupported entry: ${relative}.`);
    if (SENSITIVE_FILE.test(relative)) throw new Error(`Plugin package refuses a potentially secret file: ${relative}.`);
    if (stats.size > MAX_AUTHORING_FILE_BYTES) throw new Error(`Plugin package file exceeds the per-file limit: ${relative}.`);
    files.push({ absolute, relative, sizeBytes: stats.size });
  }
  return files;
}

function isSafeDistributionPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !normalized.startsWith("\\")
    && !normalized.includes("\\")
    && !normalized.includes("\u0000")
    && !/[?*\[\]{}!]/.test(normalized)
    && normalized.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * Honors a deliberately small, deterministic subset of npm's `files` field.
 * Entries are literal files or directory roots only: no glob expansion means
 * an author can inspect exactly what is signed before the archive is created.
 */
function selectDistributionFiles(files, packageManifest) {
  if (packageManifest?.files === undefined) return { files, errors: [] };
  if (!Array.isArray(packageManifest.files)) {
    return { files: [], errors: ["package.json files must be an array of literal file or directory paths."] };
  }

  const selected = new Set(["package.json", "sps-plugin.json"]);
  const errors = [];
  for (const [index, value] of packageManifest.files.entries()) {
    if (!isSafeDistributionPath(value)) {
      errors.push(`package.json files[${index}] must be a safe literal file or directory path.`);
      continue;
    }
    const prefix = value.endsWith("/") ? value.slice(0, -1) : value;
    const matches = files.filter((file) => file.relative === prefix || file.relative.startsWith(`${prefix}/`));
    if (matches.length === 0) {
      errors.push(`package.json files[${index}] does not match a package file: ${value}.`);
      continue;
    }
    for (const match of matches) selected.add(match.relative);
  }

  return { files: files.filter((file) => selected.has(file.relative)), errors };
}

function compareSemver(left, right) {
  const parse = (value) => {
    const [core, prerelease = ""] = value.split("-", 2);
    return { core: core.split(".").map(Number), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function isSafeArtifactUrl(value) {
  if (isSafeRegistryRelativePath(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

async function writeJsonNew(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

/** Inspects a plugin directory without importing its runtime JavaScript. */
export async function inspectPluginDirectory(sourceDirectory) {
  const errors = [];
  let root;
  try {
    root = await fs.realpath(sourceDirectory);
    const stats = await fs.lstat(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Plugin source root must be a real directory.");
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], source: null, files: [] };
  }

  let files = [];
  let packageManifest = null;
  let staticManifest = null;
  try {
    files = await collectPluginFiles(root);
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalBytes > MAX_AUTHORING_TOTAL_BYTES) errors.push("Plugin package exceeds the total 512 MiB limit.");
    const allFiles = files;
    const allFileMap = new Map(allFiles.map((file) => [file.relative, file]));
    if (!allFileMap.has("package.json")) errors.push("Plugin package must contain root package.json.");
    if (!allFileMap.has("sps-plugin.json")) errors.push("Plugin package must contain root sps-plugin.json.");
    if (allFileMap.has("package.json")) packageManifest = await readJson(path.join(root, "package.json"), "package.json");
    if (allFileMap.has("sps-plugin.json")) staticManifest = await readJson(path.join(root, "sps-plugin.json"), "sps-plugin.json");
    const distribution = selectDistributionFiles(allFiles, packageManifest);
    files = distribution.files;
    errors.push(...distribution.errors);
    const fileMap = new Map(files.map((file) => [file.relative, file]));
    if (!isPlainObject(packageManifest) || typeof packageManifest?.name !== "string" || packageManifest.name.trim().length === 0) {
      errors.push("package.json name is required.");
    }
    if (!SEMVER.test(packageManifest?.version ?? "")) errors.push("package.json version must be SemVer.");
    const staticValidation = validateStaticPluginManifest(staticManifest);
    errors.push(...staticValidation.errors);
    if (staticValidation.valid && packageManifest?.version !== staticManifest.plugin.version) {
      errors.push("package.json version must match sps-plugin.json plugin.version.");
    }
    if (staticValidation.valid) {
      const runtime = fileMap.get(staticManifest.runtime.manifestEntry);
      if (!runtime) {
        errors.push("sps-plugin.json runtime.manifestEntry does not exist in the package.");
      } else {
        const digest = sha256(await fs.readFile(runtime.absolute));
        if (digest !== staticManifest.runtime.manifestSha256) {
          errors.push("sps-plugin.json runtime.manifestSha256 does not match the source runtime entry.");
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    valid: errors.length === 0,
    errors,
    source: errors.length === 0 ? {
      root,
      package: { name: packageManifest.name, version: packageManifest.version },
      staticManifest,
    } : null,
    files,
  };
}

/** Creates an immutable .spsplugin ZIP after the source has passed static checks. */
export async function packagePluginDirectory({ sourceDirectory, archivePath, overwrite = false } = {}) {
  if (typeof archivePath !== "string" || archivePath.trim().length === 0) throw new Error("Plugin archive output path is required.");
  const inspection = await inspectPluginDirectory(sourceDirectory);
  if (!inspection.valid || !inspection.source) throw new Error(inspection.errors.join("\n"));
  const output = assertSafeOutputPath(inspection.source.root, archivePath);
  try {
    const existing = await fs.lstat(output);
    if (!existing.isFile() || existing.isSymbolicLink() || !overwrite) throw new Error("Plugin archive output already exists. Pass overwrite=true to replace it.");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (!overwrite || error.message.includes("already exists")) throw error;
    }
  }
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  try {
    await new Promise((resolve, reject) => {
      const zip = new yazl.ZipFile();
      const destination = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
      destination.on("error", reject);
      zip.outputStream.on("error", reject).pipe(destination).on("close", resolve);
      for (const file of inspection.files) {
        zip.addFile(file.absolute, file.relative, { compress: true, mtime: new Date(0), mode: 0o100644 });
      }
      zip.end();
    });
    if (overwrite) await fs.rm(output, { force: true });
    await fs.rename(temporary, output);
    const archive = await inspectPluginArchive(output);
    if (!archive.valid) throw new Error(archive.errors.join("\n"));
    return { archivePath: output, archive, source: inspection.source };
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function generatePluginSigningKeyPair() {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
  };
}

export async function writePluginSigningKeyPair({ privateKeyPath, publicKeyPath } = {}) {
  if (!privateKeyPath || !publicKeyPath) throw new Error("Private and public key output paths are required.");
  const keyPair = generatePluginSigningKeyPair();
  await writeJsonNew(`${privateKeyPath}.metadata.json`, { algorithm: "ed25519", createdAt: new Date().toISOString() });
  try {
    await fs.writeFile(privateKeyPath, keyPair.privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.writeFile(publicKeyPath, keyPair.publicKey, { encoding: "utf8", mode: 0o644, flag: "wx" });
  } catch (error) {
    await Promise.all([
      fs.rm(privateKeyPath, { force: true }),
      fs.rm(publicKeyPath, { force: true }),
      fs.rm(`${privateKeyPath}.metadata.json`, { force: true }),
    ]);
    throw error;
  }
  return keyPair;
}

/** Builds and verifies a publisher-signed immutable release record. */
export async function createSignedPluginRelease({
  archivePath,
  artifactUrl,
  publisherId,
  publisherKeyId,
  publisherPrivateKey,
  compatibilitySps = ">=0.4.0",
  pluginApi = 1,
  visibility = "public",
  catalog,
  publishedAt = new Date().toISOString(),
} = {}) {
  if (!PUBLISHER_ID.test(publisherId ?? "")) throw new Error("Publisher id is invalid.");
  if (!isSafeArtifactUrl(artifactUrl)) throw new Error("Artifact URL must be a safe relative path or HTTPS URL without credentials or a fragment.");
  if (typeof publisherKeyId !== "string" || !publisherKeyId.startsWith("ed25519:")) throw new Error("Publisher key id must be Ed25519.");
  if (typeof publisherPrivateKey !== "string" || publisherPrivateKey.length === 0) throw new Error("Publisher private key is required.");
  const archive = await inspectPluginArchive(archivePath);
  if (!archive.valid || !archive.package?.staticManifest) throw new Error(archive.errors.join("\n"));
  const artifact = await fs.readFile(archivePath);
  const staticManifest = archive.package.staticManifest;
  const record = {
    registrySchemaVersion: 1,
    plugin: { id: staticManifest.plugin.id, version: staticManifest.plugin.version },
    artifact: { url: artifactUrl, sha256: sha256(artifact), sizeBytes: artifact.length },
    publisher: { id: publisherId, keyId: publisherKeyId },
    signature: { algorithm: "ed25519", value: "" },
    compatibility: { sps: compatibilitySps, pluginApi },
    visibility,
    ...(catalog === undefined ? {} : { catalog }),
    capabilities: [...staticManifest.capabilities],
    permissionsDigest: staticManifest.permissionsDigest,
    publishedAt,
  };
  record.signature.value = sign(null, Buffer.from(canonicalizeReleaseRecord(record)), publisherPrivateKey).toString("base64");
  const validation = validateReleaseRecord(record);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const publicKey = createPublicKey(publisherPrivateKey).export({ type: "spki", format: "pem" });
  const signature = verifyReleaseRecordSignature(record, publicKey);
  if (!signature.valid) throw new Error(signature.errors.join("\n"));
  return { record, publicKey };
}

/** Builds one signed static Registry index from already signed release records. */
export function createSignedRegistryIndex({
  registryId,
  displayName,
  publisherKeys,
  publisherProfiles = [],
  releaseRecords,
  registryRootKeyId,
  registryRootPrivateKey,
  updatedAt = new Date().toISOString(),
} = {}) {
  if (!PUBLISHER_ID.test(registryId ?? "")) throw new Error("Registry id is invalid.");
  if (typeof displayName !== "string" || displayName.trim().length === 0) throw new Error("Registry display name is required.");
  if (typeof registryRootKeyId !== "string" || !registryRootKeyId.startsWith("ed25519:")) throw new Error("Registry root key id must be Ed25519.");
  if (typeof registryRootPrivateKey !== "string" || registryRootPrivateKey.length === 0) throw new Error("Registry root private key is required.");
  if (!Array.isArray(publisherKeys) || !Array.isArray(publisherProfiles) || !Array.isArray(releaseRecords)) throw new Error("Publisher keys, profiles, and release records are required.");
  const publisherKeyMap = new Map(publisherKeys.map((key) => [key.keyId, key.publicKey]));
  const grouped = new Map();
  for (const release of releaseRecords) {
    if (!isPlainObject(release) || !isSafeRegistryRelativePath(release.releasePath) || !release.releasePath.endsWith(".json")) {
      throw new Error("Registry release path must be a safe .json file path.");
    }
    const validation = validateReleaseRecord(release.record);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    const publicKey = publisherKeyMap.get(release.record.publisher.keyId);
    if (!publicKey) throw new Error(`Publisher key ${release.record.publisher.keyId} is missing from the Registry index.`);
    const signature = verifyReleaseRecordSignature(release.record, publicKey);
    if (!signature.valid) throw new Error(signature.errors.join("\n"));
    const current = grouped.get(release.record.plugin.id) ?? [];
    if (current.some((entry) => entry.version === release.record.plugin.version || entry.releasePath === release.releasePath)) {
      throw new Error(`Registry contains a duplicate release for ${release.record.plugin.id}.`);
    }
    current.push({ version: release.record.plugin.version, releasePath: release.releasePath });
    grouped.set(release.record.plugin.id, current);
  }
  const plugins = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, releases]) => {
      releases.sort((left, right) => compareSemver(left.version, right.version));
      return { id, latest: releases.at(-1).version, releases: releases.map((release) => release.releasePath) };
    });
  const index = {
    registrySchemaVersion: 1,
    registryId,
    displayName,
    updatedAt,
    publisherKeys: [...publisherKeys].sort((left, right) => left.keyId.localeCompare(right.keyId)),
    ...(publisherProfiles.length === 0 ? {} : { publishers: [...publisherProfiles].sort((left, right) => left.id.localeCompare(right.id)) }),
    plugins,
    signature: { keyId: registryRootKeyId, algorithm: "ed25519", value: "" },
  };
  index.signature.value = sign(null, Buffer.from(canonicalizeRegistryIndex(index)), registryRootPrivateKey).toString("base64");
  const validation = validateRegistryIndex(index);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const publicKey = createPublicKey(registryRootPrivateKey).export({ type: "spki", format: "pem" });
  const signature = verifyRegistryIndexSignature(index, { keyId: registryRootKeyId, publicKey });
  if (!signature.valid) throw new Error(signature.errors.join("\n"));
  return { index, publicKey };
}

function resolveRegistryFile(registryRoot, relativePath, label) {
  if (!isSafeRegistryRelativePath(relativePath)) throw new Error(`${label} must be a safe Registry-relative path.`);
  const target = path.resolve(registryRoot, ...relativePath.split("/"));
  if (!isPathInside(registryRoot, target)) throw new Error(`${label} escapes the Registry root.`);
  return target;
}

async function loadExistingLocalRegistry(registryRoot) {
  const indexPath = path.join(registryRoot, "registry.json");
  let index;
  try {
    index = await readJson(indexPath, "registry.json");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const validation = validateRegistryIndex(index);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const publisherKeys = new Map(index.publisherKeys.map((entry) => [entry.keyId, entry]));
  const publisherProfiles = new Map((index.publishers ?? []).map((entry) => [entry.id, entry]));
  const releaseRecords = [];
  for (const plugin of index.plugins) {
    for (const releasePath of plugin.releases) {
      const absolutePath = resolveRegistryFile(registryRoot, releasePath, "Registry release record");
      const record = await readJson(absolutePath, `Registry release record ${releasePath}`);
      releaseRecords.push({ releasePath, record });
    }
  }
  return { index, publisherKeys, publisherProfiles, releaseRecords };
}

async function replaceJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

/**
 * Publishes one immutable archive into an explicit local Registry folder.
 * Private signing keys are supplied by the caller and never written there.
 */
export async function publishPluginToLocalRegistry({
  sourceDirectory,
  registryDirectory,
  registryId,
  displayName,
  publisherId,
  publisherKeyId,
  publisherPrivateKey,
  registryRootKeyId,
  registryRootPrivateKey,
  compatibilitySps = ">=0.4.0",
  visibility = "public",
  catalog,
  publisherProfile,
  publishedAt = new Date().toISOString(),
} = {}) {
  if (!registryDirectory) throw new Error("Local Registry directory is required.");
  if (!PUBLISHER_ID.test(registryId ?? "")) throw new Error("Registry id is invalid.");
  if (typeof displayName !== "string" || displayName.trim().length === 0) throw new Error("Registry display name is required.");
  if (!PUBLISHER_ID.test(publisherId ?? "")) throw new Error("Publisher id is invalid.");
  if (typeof publisherKeyId !== "string" || !publisherKeyId.startsWith("ed25519:")) throw new Error("Publisher key id must be Ed25519.");
  if (typeof registryRootKeyId !== "string" || !registryRootKeyId.startsWith("ed25519:")) throw new Error("Registry root key id must be Ed25519.");
  if (typeof publisherPrivateKey !== "string" || publisherPrivateKey.length === 0) throw new Error("Publisher private key is required.");
  if (typeof registryRootPrivateKey !== "string" || registryRootPrivateKey.length === 0) throw new Error("Registry root private key is required.");
  const nextPublisherProfile = publisherProfile === undefined ? null : { ...publisherProfile, id: publisherId };
  if (nextPublisherProfile) {
    const profileValidation = validateRegistryPublisherProfile(nextPublisherProfile);
    if (!profileValidation.valid) throw new Error(profileValidation.errors.join("\n"));
  }

  await fs.mkdir(path.resolve(registryDirectory), { recursive: true, mode: 0o700 });
  const registryRoot = await fs.realpath(registryDirectory);
  const publisherPublicKey = createPublicKey(publisherPrivateKey).export({ type: "spki", format: "pem" });
  const registryRootPublicKey = createPublicKey(registryRootPrivateKey).export({ type: "spki", format: "pem" });
  const existing = await loadExistingLocalRegistry(registryRoot);
  if (existing && (existing.index.registryId !== registryId || existing.index.displayName !== displayName)) {
    throw new Error("Registry id and display name must match the existing Registry index.");
  }
  if (existing && existing.index.signature.keyId !== registryRootKeyId) {
    throw new Error("Registry root key id must match the existing Registry index.");
  }
  if (existing) {
    const signature = verifyRegistryIndexSignature(existing.index, {
      keyId: registryRootKeyId,
      publicKey: registryRootPublicKey,
    });
    if (!signature.valid) throw new Error(signature.errors.join("\n"));
  }

  const inspection = await inspectPluginDirectory(sourceDirectory);
  if (!inspection.valid || !inspection.source) throw new Error(inspection.errors.join("\n"));
  const plugin = inspection.source.staticManifest.plugin;
  const artifactRelativePath = `packages/${plugin.id}-${plugin.version}.spsplugin`;
  const releaseRelativePath = `releases/${plugin.id}-${plugin.version}.json`;
  const artifactPath = resolveRegistryFile(registryRoot, artifactRelativePath, "Registry artifact");
  const releasePath = resolveRegistryFile(registryRoot, releaseRelativePath, "Registry release record");
  const existingReleasePaths = new Set(existing?.releaseRecords.map((entry) => entry.releasePath) ?? []);
  if (existingReleasePaths.has(releaseRelativePath)) throw new Error("Registry release already exists and is immutable.");

  const publisherKeys = new Map(existing?.publisherKeys ?? []);
  const existingPublisher = publisherKeys.get(publisherKeyId);
  if (existingPublisher && existingPublisher.publicKey !== publisherPublicKey) {
    throw new Error("Publisher key id is already bound to a different public key.");
  }
  publisherKeys.set(publisherKeyId, { keyId: publisherKeyId, algorithm: "ed25519", publicKey: publisherPublicKey });
  const publisherProfiles = new Map(existing?.publisherProfiles ?? []);
  if (nextPublisherProfile) {
    publisherProfiles.set(publisherId, nextPublisherProfile);
  }

  await packagePluginDirectory({ sourceDirectory, archivePath: artifactPath });
  try {
    const release = await createSignedPluginRelease({
      archivePath: artifactPath,
      artifactUrl: artifactRelativePath,
      publisherId,
      publisherKeyId,
      publisherPrivateKey,
      compatibilitySps,
      visibility,
      catalog,
      publishedAt,
    });
    await writeJsonNew(releasePath, release.record);
    const signed = createSignedRegistryIndex({
      registryId,
      displayName,
      publisherKeys: [...publisherKeys.values()],
      publisherProfiles: [...publisherProfiles.values()],
      releaseRecords: [...(existing?.releaseRecords ?? []), { releasePath: releaseRelativePath, record: release.record }],
      registryRootKeyId,
      registryRootPrivateKey,
    });
    if (signed.publicKey !== registryRootPublicKey) throw new Error("Registry root signing key could not be verified.");
    const indexPath = path.join(registryRoot, "registry.json");
    await replaceJson(indexPath, signed.index);
    return {
      registryRoot,
      indexPath,
      artifactPath,
      releasePath,
      plugin: release.record.plugin,
      registryPublicKey: registryRootPublicKey,
    };
  } catch (error) {
    await Promise.all([
      fs.rm(artifactPath, { force: true }),
      fs.rm(releasePath, { force: true }),
    ]);
    throw error;
  }
}

/** Creates the smallest Core-valid Plugin source tree with a minimal scoped capability. */
export async function createPluginTemplate({ directory, pluginId, packageName, displayName = "SPS Plugin", version = "0.1.0" } = {}) {
  if (!PLUGIN_ID.test(pluginId ?? "")) throw new Error("Plugin id is invalid.");
  if (!SEMVER.test(version)) throw new Error("Plugin version must be SemVer.");
  if (typeof packageName !== "string" || packageName.trim().length === 0) throw new Error("Package name is required.");
  const root = path.resolve(directory ?? "");
  if (!root || root === path.parse(root).root) throw new Error("Plugin template directory is required.");
  try {
    const entries = await fs.readdir(root);
    if (entries.length > 0) throw new Error("Plugin template directory must be empty.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const manifestPath = path.join(root, "dist", "manifest.js");
  const workerPath = path.join(root, "dist", "worker.js");
  const runtime = [
    "export default {",
    `  id: ${JSON.stringify(pluginId)},`,
    "  apiVersion: 1,",
    `  version: ${JSON.stringify(version)},`,
    `  displayName: ${JSON.stringify(displayName)},`,
    "  description: \"Generated SPS Plugin.\",",
    "  author: \"SPS Plugin Author\",",
    "  categories: [\"automation\"],",
    '  capabilities: ["plugin.state.read"],',
    "  entrypoints: { worker: \"./dist/worker.js\" },",
    "};",
    "",
  ].join("\n");
  const worker = [
    'import { createInterface } from "node:readline";',
    "",
    "// This tiny worker is dependency-free. It proves the Host RPC lifecycle",
    "// before an author adds the SDK and bundles feature code.",
    'const supportedMethods = ["health"];',
    "",
    "function reply(id, result) {",
    '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");',
    "}",
    "",
    "function reject(id, message) {",
    '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } }) + "\\n");',
    "}",
    "",
    'const input = createInterface({ input: process.stdin });',
    'input.on("line", (line) => {',
    "  let request;",
    "  try { request = JSON.parse(line); } catch { return; }",
    '  if (!request || request.jsonrpc !== "2.0" || request.id === undefined) return;',
    '  if (request.method === "initialize") {',
    "    reply(request.id, { ok: true, supportedMethods });",
    '  } else if (request.method === "health") {',
    '    reply(request.id, { status: "ok", message: "Generated SPS Plugin is ready" });',
    '  } else if (request.method === "shutdown") {',
    "    reply(request.id, null);",
    "    input.close();",
    "    setImmediate(() => process.exit(0));",
    "  } else {",
    '    reject(request.id, "Unknown method: " + request.method);',
    "  }",
    "});",
    "",
  ].join("\n");
  // Core manifests require at least one capability. This read-only,
  // plugin-scoped capability is safe for a generated starter that registers
  // no tools, jobs, routes, or external integrations.
  const capabilities = ["plugin.state.read"];
  const staticManifest = {
    schemaVersion: 1,
    plugin: { id: pluginId, version, apiVersion: "1" },
    runtime: { manifestEntry: "dist/manifest.js", manifestSha256: sha256(runtime) },
    capabilities,
    permissionsDigest: calculateStaticCapabilitiesDigest(capabilities),
  };
  await fs.mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  await Promise.all([
    fs.writeFile(manifestPath, runtime, { encoding: "utf8", mode: 0o644, flag: "wx" }),
    fs.writeFile(workerPath, worker, { encoding: "utf8", mode: 0o644, flag: "wx" }),
    fs.writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: packageName, version, private: true, type: "module", paperclipPlugin: { manifest: "./dist/manifest.js", worker: "./dist/worker.js" } }, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" }),
    fs.writeFile(path.join(root, "sps-plugin.json"), `${JSON.stringify(staticManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" }),
    fs.writeFile(path.join(root, "README.md"), `# ${displayName}\n\nGenerated by SPS Plugin Kit. The included Worker only proves the Host RPC lifecycle. Add capabilities deliberately, bundle SDK-based feature code, then update sps-plugin.json before packaging.\n`, { encoding: "utf8", mode: 0o644, flag: "wx" }),
  ]);
  return await inspectPluginDirectory(root);
}
