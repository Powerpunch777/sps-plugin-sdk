import { promises as fs } from "node:fs";
import yauzl from "yauzl";
import { validateStaticPluginManifest } from "./static-package-manifest-v1.mjs";

export const MAX_PLUGIN_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_PLUGIN_ARCHIVE_ENTRIES = 4096;
export const MAX_PLUGIN_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
export const MAX_PLUGIN_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function isSafePluginArchiveEntryName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 512) return false;
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = normalized.split("/");
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !normalized.startsWith("\\")
    && !normalized.includes("\\")
    && !normalized.includes("\u0000")
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isSymbolicLink(entry) {
  const unixMode = entry.externalFileAttributes >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

function isRegularFileOrDirectory(entry) {
  const unixMode = entry.externalFileAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  return fileType === 0 || fileType === 0o100000 || fileType === 0o040000;
}

async function readEntryUtf8(zipfile, entry) {
  const stream = await zipfile.openReadStreamPromise(entry);
  const chunks = [];
  let sizeBytes = 0;
  for await (const chunk of stream) {
    sizeBytes += chunk.length;
    if (sizeBytes > MAX_PACKAGE_MANIFEST_BYTES) {
      stream.destroy();
      throw new Error("package.json exceeds the manifest size limit.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function inspectStaticPackageManifest(raw) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ["sps-plugin.json is not valid JSON."], manifest: null };
  }
  const validation = validateStaticPluginManifest(manifest);
  return { valid: validation.valid, errors: validation.errors, manifest: validation.valid ? manifest : null };
}

function inspectPackageManifest(raw) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ["package.json is not valid JSON."], package: null };
  }
  const errors = [];
  if (!isPlainObject(manifest)) errors.push("package.json must contain an object.");
  if (typeof manifest?.name !== "string" || manifest.name.trim().length === 0 || manifest.name.length > 214) {
    errors.push("package.json name is required.");
  }
  if (!SEMVER.test(manifest?.version ?? "")) errors.push("package.json version must be SemVer.");
  return {
    valid: errors.length === 0,
    errors,
    package: errors.length === 0 ? { name: manifest.name, version: manifest.version } : null,
  };
}

/**
 * Inspects a .spsplugin ZIP without executing, extracting, or installing it.
 * Extraction must repeat its own stream-time size checks before writing files.
 */
export async function inspectPluginArchive(archivePath) {
  const errors = [];
  let archiveBytes;
  try {
    const stats = await fs.stat(archivePath);
    if (!stats.isFile()) throw new Error("Plugin archive must be a file.");
    archiveBytes = stats.size;
    if (archiveBytes <= 0 || archiveBytes > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw new Error(`Plugin archive must be between 1 and ${MAX_PLUGIN_ARCHIVE_BYTES} bytes.`);
    }
  } catch (error) {
    return { valid: false, errors: [`Plugin archive is unavailable: ${error.message}`], archive: null, package: null };
  }

  let zipfile;
  try {
    zipfile = await yauzl.openPromise(archivePath, {
      autoClose: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch (error) {
    return { valid: false, errors: [`Plugin archive is not a valid ZIP: ${error.message}`], archive: null, package: null };
  }

  const seenNames = new Set();
  let entryCount = 0;
  let uncompressedBytes = 0;
  let packageManifestRaw = null;
  let staticManifestRaw = null;

  try {
    for await (const entry of zipfile.eachEntry()) {
      entryCount += 1;
      if (entryCount > MAX_PLUGIN_ARCHIVE_ENTRIES) {
        errors.push(`Plugin archive exceeds ${MAX_PLUGIN_ARCHIVE_ENTRIES} entries.`);
        break;
      }

      const entryName = entry.fileName;
      const normalizedName = entryName.endsWith("/") ? entryName.slice(0, -1) : entryName;
      const collisionKey = normalizedName.toLowerCase();
      if (!isSafePluginArchiveEntryName(entryName)) errors.push(`Unsafe archive entry path: ${entryName}.`);
      if (seenNames.has(collisionKey)) errors.push(`Duplicate or case-colliding archive entry: ${entryName}.`);
      seenNames.add(collisionKey);
      if (isSymbolicLink(entry)) errors.push(`Symbolic links are not allowed: ${entryName}.`);
      if (!isRegularFileOrDirectory(entry)) errors.push(`Unsupported archive entry type: ${entryName}.`);
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) errors.push(`Encrypted archive entries are not supported: ${entryName}.`);
      if (typeof entry.canDecodeFileData === "function" && !entry.canDecodeFileData()) {
        errors.push(`Unsupported archive compression for ${entryName}.`);
      }

      if (!entryName.endsWith("/")) {
        if (entry.uncompressedSize > MAX_PLUGIN_ARCHIVE_ENTRY_BYTES) {
          errors.push(`Archive entry exceeds ${MAX_PLUGIN_ARCHIVE_ENTRY_BYTES} bytes: ${entryName}.`);
        }
        uncompressedBytes += entry.uncompressedSize;
        if (uncompressedBytes > MAX_PLUGIN_ARCHIVE_UNCOMPRESSED_BYTES) {
          errors.push(`Plugin archive exceeds ${MAX_PLUGIN_ARCHIVE_UNCOMPRESSED_BYTES} uncompressed bytes.`);
          break;
        }
      }

      if (entryName === "package.json") {
        if (entry.uncompressedSize > MAX_PACKAGE_MANIFEST_BYTES) {
          errors.push("package.json exceeds the manifest size limit.");
        } else if (packageManifestRaw !== null) {
          errors.push("Plugin archive contains duplicate package.json entries.");
        } else {
          packageManifestRaw = await readEntryUtf8(zipfile, entry);
        }
      }
      if (entryName === "sps-plugin.json") {
        if (entry.uncompressedSize > MAX_PACKAGE_MANIFEST_BYTES) {
          errors.push("sps-plugin.json exceeds the manifest size limit.");
        } else if (staticManifestRaw !== null) {
          errors.push("Plugin archive contains duplicate sps-plugin.json entries.");
        } else {
          staticManifestRaw = await readEntryUtf8(zipfile, entry);
        }
      }
    }
  } catch (error) {
    errors.push(`Plugin archive could not be inspected safely: ${error.message}`);
  }

  if (packageManifestRaw === null) errors.push("Plugin archive must contain one root package.json.");
  const manifestInspection = packageManifestRaw === null
    ? { valid: false, errors: [], package: null }
    : inspectPackageManifest(packageManifestRaw);
  errors.push(...manifestInspection.errors);
  if (staticManifestRaw === null) errors.push("Plugin archive must contain one root sps-plugin.json.");
  const staticManifestInspection = staticManifestRaw === null
    ? { valid: false, errors: [], manifest: null }
    : inspectStaticPackageManifest(staticManifestRaw);
  errors.push(...staticManifestInspection.errors);
  if (staticManifestInspection.manifest && !seenNames.has(staticManifestInspection.manifest.runtime.manifestEntry.toLowerCase())) {
    errors.push("sps-plugin.json runtime.manifestEntry is missing from the archive.");
  }

  return {
    valid: errors.length === 0,
    errors,
    archive: { sizeBytes: archiveBytes, entryCount, uncompressedBytes },
    package: manifestInspection.package && staticManifestInspection.manifest
      ? { ...manifestInspection.package, staticManifest: staticManifestInspection.manifest }
      : null,
  };
}
