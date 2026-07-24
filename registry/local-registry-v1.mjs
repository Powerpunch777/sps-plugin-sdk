import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import {
  isSafeRegistryRelativePath,
  validateRegistryIndex,
  validateReleaseRecord,
  verifyReleaseRecordSignature,
} from "./release-record-v1.mjs";

const MAX_METADATA_BYTES = 1024 * 1024;

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function resolveFileInsideRegistry(root, relativePath, label) {
  if (!isSafeRegistryRelativePath(relativePath)) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  const unresolved = path.resolve(root, ...relativePath.split("/"));
  if (!isPathInside(root, unresolved)) {
    throw new Error(`${label} escapes the registry root.`);
  }
  const resolved = await fs.realpath(unresolved);
  if (!isPathInside(root, resolved)) {
    throw new Error(`${label} resolves outside the registry root.`);
  }
  const stats = await fs.stat(resolved);
  if (!stats.isFile()) {
    throw new Error(`${label} must point to a file.`);
  }
  return { path: resolved, sizeBytes: stats.size };
}

async function readJsonFile(filePath, label) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size > MAX_METADATA_BYTES) {
    throw new Error(`${label} exceeds the metadata size limit.`);
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Inspects a local Registry without executing or unpacking any plugin code.
 * The caller may use a valid report to present an install preview; this module
 * never installs, enables, or loads a plugin.
 */
export async function inspectLocalRegistry(registryRoot) {
  const errors = [];
  const releases = [];
  let root;
  try {
    root = await fs.realpath(registryRoot);
    const rootStats = await fs.stat(root);
    if (!rootStats.isDirectory()) throw new Error("Registry root must be a directory.");
  } catch (error) {
    return { valid: false, errors: [`Registry root is unavailable: ${error.message}`], releases };
  }

  let index;
  try {
    const indexFile = await resolveFileInsideRegistry(root, "registry.json", "Registry index");
    index = await readJsonFile(indexFile.path, "Registry index");
  } catch (error) {
    return { valid: false, errors: [error.message], releases };
  }

  const indexValidation = validateRegistryIndex(index);
  if (!indexValidation.valid) {
    return { valid: false, errors: indexValidation.errors, releases };
  }
  const publisherKeys = new Map(index.publisherKeys.map((key) => [key.keyId, key.publicKey]));
  const publisherProfiles = new Map((index.publishers ?? []).map((profile) => [profile.id, profile]));
  const versionsByPlugin = new Map(index.plugins.map((plugin) => [plugin.id, new Set()]));

  for (const plugin of index.plugins) {
    for (const releasePath of plugin.releases) {
      const releaseLabel = `${plugin.id} (${releasePath})`;
      let record;
      try {
        const releaseFile = await resolveFileInsideRegistry(root, releasePath, `Release record for ${releaseLabel}`);
        record = await readJsonFile(releaseFile.path, `Release record for ${releaseLabel}`);
      } catch (error) {
        errors.push(error.message);
        continue;
      }

      const recordValidation = validateReleaseRecord(record);
      if (!recordValidation.valid) {
        errors.push(...recordValidation.errors.map((message) => `${releaseLabel}: ${message}`));
        continue;
      }
      if (record.plugin.id !== plugin.id) {
        errors.push(`${releaseLabel}: release plugin.id does not match its index entry.`);
        continue;
      }

      const publicKey = publisherKeys.get(record.publisher.keyId);
      if (!publicKey) {
        errors.push(`${releaseLabel}: publisher key ${record.publisher.keyId} is not in the registry index.`);
        continue;
      }
      const signatureValidation = verifyReleaseRecordSignature(record, publicKey);
      if (!signatureValidation.valid) {
        errors.push(...signatureValidation.errors.map((message) => `${releaseLabel}: ${message}`));
        continue;
      }
      if (!isSafeRegistryRelativePath(record.artifact.url)) {
        errors.push(`${releaseLabel}: local Registry artifacts must use safe relative paths.`);
        continue;
      }

      try {
        const artifact = await resolveFileInsideRegistry(root, record.artifact.url, `Artifact for ${releaseLabel}`);
        if (artifact.sizeBytes !== record.artifact.sizeBytes) {
          errors.push(`${releaseLabel}: artifact size does not match the release record.`);
          continue;
        }
        const sha256 = await sha256File(artifact.path);
        if (sha256 !== record.artifact.sha256) {
          errors.push(`${releaseLabel}: artifact SHA-256 does not match the release record.`);
          continue;
        }
        releases.push({
          pluginId: record.plugin.id,
          version: record.plugin.version,
          visibility: record.visibility,
          ...(record.catalog === undefined ? {} : { catalog: { ...record.catalog } }),
          ...(record.capabilities === undefined ? {} : { capabilities: [...record.capabilities] }),
          permissionsDigest: record.permissionsDigest,
          releaseRelativePath: releasePath,
          artifactRelativePath: record.artifact.url,
          artifactSha256: record.artifact.sha256,
          artifactSizeBytes: record.artifact.sizeBytes,
          publisherId: record.publisher.id,
          ...(publisherProfiles.has(record.publisher.id) ? { publisherProfile: { ...publisherProfiles.get(record.publisher.id) } } : {}),
          publisherKeyId: record.publisher.keyId,
        });
        versionsByPlugin.get(plugin.id)?.add(record.plugin.version);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  for (const plugin of index.plugins) {
    if (!versionsByPlugin.get(plugin.id)?.has(plugin.latest)) {
      errors.push(`${plugin.id}: latest version ${plugin.latest} has no verified release record.`);
    }
  }

  return { valid: errors.length === 0, errors, releases };
}
