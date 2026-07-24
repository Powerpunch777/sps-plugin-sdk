import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import {
  inspectPluginArchive,
  isSafePluginArchiveEntryName,
  MAX_PLUGIN_ARCHIVE_ENTRIES,
  MAX_PLUGIN_ARCHIVE_ENTRY_BYTES,
  MAX_PLUGIN_ARCHIVE_UNCOMPRESSED_BYTES,
} from "./archive-inspector-v1.mjs";

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function isExpectedArtifact(value) {
  return Boolean(value)
    && typeof value === "object"
    && /^[a-f0-9]{64}$/.test(value.sha256 ?? "")
    && Number.isSafeInteger(value.sizeBytes)
    && value.sizeBytes > 0;
}

async function verifyArtifactFile(archivePath, expectedArtifact) {
  if (!isExpectedArtifact(expectedArtifact)) {
    throw new Error("Expected artifact SHA-256 and size are required before extraction.");
  }
  const linkStats = await fs.lstat(archivePath);
  if (!linkStats.isFile() || linkStats.isSymbolicLink()) throw new Error("Plugin archive must be a regular file.");
  if (linkStats.size !== expectedArtifact.sizeBytes) throw new Error("Plugin archive size does not match the release record.");

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath, { flags: "r" })) hash.update(chunk);
  if (hash.digest("hex") !== expectedArtifact.sha256) {
    throw new Error("Plugin archive SHA-256 does not match the release record.");
  }
}

async function verifyStaticRuntimeManifest(destinationRoot, staticManifest) {
  const manifestPath = resolveArchiveEntryPath(destinationRoot, staticManifest.runtime.manifestEntry);
  const stats = await fs.lstat(manifestPath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Static runtime manifest must be a regular file.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(manifestPath, { flags: "r" })) hash.update(chunk);
  if (hash.digest("hex") !== staticManifest.runtime.manifestSha256) {
    throw new Error("Static runtime manifest SHA-256 does not match sps-plugin.json.");
  }
}

function resolveArchiveEntryPath(destinationRoot, entryName) {
  if (!isSafePluginArchiveEntryName(entryName)) throw new Error(`Archive entry path is unsafe: ${entryName}.`);
  const normalizedName = entryName.endsWith("/") ? entryName.slice(0, -1) : entryName;
  const segments = normalizedName.split("/");
  const destination = path.resolve(destinationRoot, ...segments);
  if (!isPathInside(destinationRoot, destination)) throw new Error(`Archive entry escapes destination: ${entryName}.`);
  return destination;
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

async function writeAll(handle, chunk, position) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, position + offset);
    if (bytesWritten <= 0) throw new Error("Could not write archive entry.");
    offset += bytesWritten;
  }
}

async function extractEntry(zipfile, entry, destination) {
  const input = await zipfile.openReadStreamPromise(entry);
  const handle = await fs.open(destination, "wx", 0o600);
  let writtenBytes = 0;
  try {
    for await (const chunk of input) {
      writtenBytes += chunk.length;
      if (writtenBytes > MAX_PLUGIN_ARCHIVE_ENTRY_BYTES) {
        input.destroy();
        throw new Error(`Archive entry exceeds ${MAX_PLUGIN_ARCHIVE_ENTRY_BYTES} bytes: ${entry.fileName}.`);
      }
      await writeAll(handle, chunk, writtenBytes - chunk.length);
    }
  } finally {
    await handle.close();
  }
  if (writtenBytes !== entry.uncompressedSize) {
    await fs.rm(destination, { force: true });
    throw new Error(`Archive entry size changed while extracting: ${entry.fileName}.`);
  }
  return writtenBytes;
}

/**
 * Extracts a previously inspectable .spsplugin only into a brand-new staging
 * directory. It requires the immutable release artifact hash and size, then
 * checks them before and after extraction. The caller can only promote the
 * result after further manifest and capability checks.
 */
export async function extractPluginArchive({ archivePath, destinationRoot, expectedArtifact }) {
  try {
    await verifyArtifactFile(archivePath, expectedArtifact);
  } catch (error) {
    return { extracted: false, errors: [`Plugin archive verification failed: ${error.message}`], inspection: null };
  }
  const inspection = await inspectPluginArchive(archivePath);
  if (!inspection.valid) {
    return { extracted: false, errors: inspection.errors, inspection };
  }

  const destination = path.resolve(destinationRoot);
  try {
    await fs.mkdir(destination, { recursive: false, mode: 0o700 });
  } catch (error) {
    return {
      extracted: false,
      errors: [`Plugin staging directory must be new: ${error.message}`],
      inspection,
    };
  }

  const seenNames = new Set();
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  try {
    const zipfile = await yauzl.openPromise(archivePath, {
      autoClose: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    for await (const entry of zipfile.eachEntry()) {
      entryCount += 1;
      if (entryCount > MAX_PLUGIN_ARCHIVE_ENTRIES) throw new Error(`Plugin archive exceeds ${MAX_PLUGIN_ARCHIVE_ENTRIES} entries.`);
      const entryName = entry.fileName;
      const normalizedName = entryName.endsWith("/") ? entryName.slice(0, -1) : entryName;
      const collisionKey = normalizedName.toLowerCase();
      if (seenNames.has(collisionKey)) throw new Error(`Duplicate or case-colliding archive entry: ${entryName}.`);
      seenNames.add(collisionKey);
      if (isSymbolicLink(entry)) throw new Error(`Symbolic links are not allowed: ${entryName}.`);
      if (!isRegularFileOrDirectory(entry)) throw new Error(`Unsupported archive entry type: ${entryName}.`);
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error(`Encrypted archive entries are not supported: ${entryName}.`);
      if (typeof entry.canDecodeFileData === "function" && !entry.canDecodeFileData()) {
        throw new Error(`Unsupported archive compression for ${entryName}.`);
      }

      const entryDestination = resolveArchiveEntryPath(destination, entryName);
      if (entryName.endsWith("/")) {
        await fs.mkdir(entryDestination, { recursive: true, mode: 0o700 });
        continue;
      }
      if (entry.uncompressedSize > MAX_PLUGIN_ARCHIVE_ENTRY_BYTES) {
        throw new Error(`Archive entry exceeds ${MAX_PLUGIN_ARCHIVE_ENTRY_BYTES} bytes: ${entryName}.`);
      }
      totalUncompressedBytes += entry.uncompressedSize;
      if (totalUncompressedBytes > MAX_PLUGIN_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new Error(`Plugin archive exceeds ${MAX_PLUGIN_ARCHIVE_UNCOMPRESSED_BYTES} uncompressed bytes.`);
      }
      await fs.mkdir(path.dirname(entryDestination), { recursive: true, mode: 0o700 });
      await extractEntry(zipfile, entry, entryDestination);
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    return {
      extracted: false,
      errors: [`Plugin archive extraction failed: ${error.message}`],
      inspection,
    };
  }

  try {
    await verifyStaticRuntimeManifest(destination, inspection.package.staticManifest);
    await verifyArtifactFile(archivePath, expectedArtifact);
    return {
      extracted: true,
      errors: [],
      inspection,
      destinationRoot: destination,
    };
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    return {
      extracted: false,
      errors: [`Plugin archive verification failed after extraction: ${error.message}`],
      inspection,
    };
  }
}
