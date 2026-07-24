import { createHash, verify } from "node:crypto";

export const SPS_REGISTRY_SCHEMA_VERSION = 1;

const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]{2,127}$/;
const PUBLISHER_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VISIBILITY = new Set(["public", "unlisted", "private"]);
const MAX_CATALOG_NAME_LENGTH = 120;
const MAX_CATALOG_SUMMARY_LENGTH = 600;
const MAX_CATALOG_DOCUMENTATION_URL_LENGTH = 2_048;
const MAX_PUBLISHER_NAME_LENGTH = 120;
const MAX_PUBLISHER_WEBSITE_URL_LENGTH = 2_048;
const CATALOG_FIELDS = new Set(["displayName", "summary", "documentationUrl"]);
const PUBLISHER_PROFILE_FIELDS = new Set(["id", "displayName", "websiteUrl"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isIsoDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isBase64(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192 || value.length % 4 !== 0) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.toString("base64") === value;
}

function isEd25519Signature(value) {
  return isBase64(value) && Buffer.from(value, "base64").length === 64;
}

function verifyEd25519(payload, publicKey, signature) {
  try {
    return verify(null, Buffer.from(payload), publicKey, signature);
  } catch {
    return false;
  }
}

export function isSafeRegistryRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !value.includes("\\")
    && !value.includes(":")
    && !value.includes("?")
    && !value.includes("#")
    && !value.includes("\u0000")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isArtifactLocator(value) {
  if (isSafeRegistryRelativePath(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeHttpsUrl(value, maximumLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function appendPublisherProfileValidation(profile, errors) {
  pushIf(isPlainObject(profile), errors, "Registry publisher profile must be an object.");
  if (!isPlainObject(profile)) return;
  pushIf(Object.keys(profile).every((key) => PUBLISHER_PROFILE_FIELDS.has(key)), errors, "Registry publisher profile contains an unsupported field.");
  pushIf(PUBLISHER_ID.test(profile.id ?? ""), errors, "Registry publisher profile id is invalid.");
  pushIf(isBoundedText(profile.displayName, MAX_PUBLISHER_NAME_LENGTH), errors, `Registry publisher profile displayName must be non-empty text up to ${MAX_PUBLISHER_NAME_LENGTH} characters.`);
  pushIf(profile.websiteUrl === undefined || isSafeHttpsUrl(profile.websiteUrl, MAX_PUBLISHER_WEBSITE_URL_LENGTH), errors, "Registry publisher profile websiteUrl must be an HTTPS URL without credentials or a fragment.");
}

export function validateRegistryPublisherProfile(profile) {
  const errors = [];
  appendPublisherProfileValidation(profile, errors);
  return { valid: errors.length === 0, errors };
}

function isBoundedText(value, maximumLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function areValidCapabilities(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const capability of value) {
    if (typeof capability !== "string" || capability.length === 0 || capability.length > 200 || seen.has(capability)) {
      return false;
    }
    seen.add(capability);
  }
  return true;
}

export function calculateReleaseCapabilitiesDigest(capabilities) {
  return createHash("sha256")
    .update(JSON.stringify([...capabilities].sort()), "utf8")
    .digest("hex");
}

function pushIf(condition, errors, message) {
  if (!condition) errors.push(message);
}

/**
 * Serializes JSON-compatible data with sorted object keys. Registry signatures
 * use this exact representation so clients do not depend on publisher spacing
 * or object key order.
 */
export function canonicalizeJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Registry records cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Registry records must contain JSON-compatible values only.");
}

/** Returns the exact signed payload for a release record. */
export function canonicalizeReleaseRecord(record) {
  if (!isPlainObject(record)) throw new TypeError("Release record must be an object.");
  const signature = isPlainObject(record.signature)
    ? { ...record.signature, value: undefined }
    : record.signature;
  if (isPlainObject(signature)) delete signature.value;
  return canonicalizeJson({ ...record, signature });
}

/** Returns the exact signed payload for a Registry index. */
export function canonicalizeRegistryIndex(index) {
  if (!isPlainObject(index)) throw new TypeError("Registry index must be an object.");
  const signature = isPlainObject(index.signature)
    ? { ...index.signature, value: undefined }
    : index.signature;
  if (isPlainObject(signature)) delete signature.value;
  return canonicalizeJson({ ...index, signature });
}

export function validateReleaseRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) {
    return { valid: false, errors: ["Release record must be an object."] };
  }

  pushIf(record.registrySchemaVersion === SPS_REGISTRY_SCHEMA_VERSION, errors, "Unsupported registrySchemaVersion.");
  pushIf(isPlainObject(record.plugin), errors, "plugin must be an object.");
  pushIf(PLUGIN_ID.test(record.plugin?.id ?? ""), errors, "plugin.id must be a stable lowercase plugin identifier.");
  pushIf(SEMVER.test(record.plugin?.version ?? ""), errors, "plugin.version must be a SemVer version.");

  pushIf(isPlainObject(record.artifact), errors, "artifact must be an object.");
  pushIf(isArtifactLocator(record.artifact?.url), errors, "artifact.url must be an HTTPS URL or a safe relative path.");
  pushIf(SHA256.test(record.artifact?.sha256 ?? ""), errors, "artifact.sha256 must be lowercase SHA-256 hex.");
  pushIf(Number.isSafeInteger(record.artifact?.sizeBytes) && record.artifact.sizeBytes > 0 && record.artifact.sizeBytes <= MAX_ARTIFACT_BYTES, errors, `artifact.sizeBytes must be between 1 and ${MAX_ARTIFACT_BYTES}.`);

  pushIf(isPlainObject(record.publisher), errors, "publisher must be an object.");
  pushIf(PUBLISHER_ID.test(record.publisher?.id ?? ""), errors, "publisher.id must be a stable publisher identifier.");
  pushIf(typeof record.publisher?.keyId === "string" && record.publisher.keyId.startsWith("ed25519:") && record.publisher.keyId.length <= 256, errors, "publisher.keyId must reference an Ed25519 key.");

  pushIf(isPlainObject(record.signature), errors, "signature must be an object.");
  pushIf(record.signature?.algorithm === "ed25519", errors, "signature.algorithm must be ed25519.");
  pushIf(isEd25519Signature(record.signature?.value), errors, "signature.value must be a base64 Ed25519 signature.");

  pushIf(isPlainObject(record.compatibility), errors, "compatibility must be an object.");
  pushIf(typeof record.compatibility?.sps === "string" && record.compatibility.sps.length > 0 && record.compatibility.sps.length <= 256, errors, "compatibility.sps is required.");
  pushIf(Number.isSafeInteger(record.compatibility?.pluginApi) && record.compatibility.pluginApi >= 1 && record.compatibility.pluginApi <= 100, errors, "compatibility.pluginApi must be a positive integer.");
  pushIf(VISIBILITY.has(record.visibility), errors, "visibility must be public, unlisted, or private.");
  if (record.catalog !== undefined) {
    pushIf(isPlainObject(record.catalog), errors, "catalog must be an object when present.");
    if (isPlainObject(record.catalog)) {
      pushIf(Object.keys(record.catalog).length > 0, errors, "catalog must contain at least one supported field.");
      pushIf(Object.keys(record.catalog).every((key) => CATALOG_FIELDS.has(key)), errors, "catalog contains an unsupported field.");
      pushIf(record.catalog.displayName === undefined || isBoundedText(record.catalog.displayName, MAX_CATALOG_NAME_LENGTH), errors, `catalog.displayName must be non-empty text up to ${MAX_CATALOG_NAME_LENGTH} characters.`);
      pushIf(record.catalog.summary === undefined || isBoundedText(record.catalog.summary, MAX_CATALOG_SUMMARY_LENGTH), errors, `catalog.summary must be non-empty text up to ${MAX_CATALOG_SUMMARY_LENGTH} characters.`);
      pushIf(record.catalog.documentationUrl === undefined || isSafeHttpsUrl(record.catalog.documentationUrl, MAX_CATALOG_DOCUMENTATION_URL_LENGTH), errors, "catalog.documentationUrl must be an HTTPS URL without credentials or a fragment.");
    }
  }
  if (record.capabilities !== undefined) {
    pushIf(areValidCapabilities(record.capabilities), errors, "capabilities must be an array of unique bounded strings when present.");
    if (areValidCapabilities(record.capabilities)) {
      pushIf(calculateReleaseCapabilitiesDigest(record.capabilities) === record.permissionsDigest, errors, "permissionsDigest does not match release capabilities.");
    }
  }
  pushIf(SHA256.test(record.permissionsDigest ?? ""), errors, "permissionsDigest must be lowercase SHA-256 hex.");
  pushIf(isIsoDate(record.publishedAt), errors, "publishedAt must be an ISO date.");

  return { valid: errors.length === 0, errors };
}

export function verifyReleaseRecordSignature(record, publicKey) {
  const validation = validateReleaseRecord(record);
  if (!validation.valid) return validation;
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    return { valid: false, errors: ["Publisher public key is required."] };
  }
  const signature = Buffer.from(record.signature.value, "base64");
  const verified = verifyEd25519(canonicalizeReleaseRecord(record), publicKey, signature);
  return verified
    ? { valid: true, errors: [] }
    : { valid: false, errors: ["Release record signature does not match the publisher key."] };
}

export function validateRegistryIndex(index) {
  const errors = [];
  if (!isPlainObject(index)) return { valid: false, errors: ["Registry index must be an object."] };

  pushIf(index.registrySchemaVersion === SPS_REGISTRY_SCHEMA_VERSION, errors, "Unsupported registrySchemaVersion.");
  pushIf(PUBLISHER_ID.test(index.registryId ?? ""), errors, "registryId must be a stable registry identifier.");
  pushIf(typeof index.displayName === "string" && index.displayName.trim().length > 0 && index.displayName.length <= 200, errors, "displayName is required.");
  pushIf(isIsoDate(index.updatedAt), errors, "updatedAt must be an ISO date.");
  pushIf(Array.isArray(index.publisherKeys), errors, "publisherKeys must be an array.");
  if (index.publishers !== undefined) pushIf(Array.isArray(index.publishers), errors, "publishers must be an array when present.");
  pushIf(Array.isArray(index.plugins), errors, "plugins must be an array.");
  if (index.signature !== undefined) {
    pushIf(isPlainObject(index.signature), errors, "Registry signature must be an object.");
    pushIf(typeof index.signature?.keyId === "string" && index.signature.keyId.startsWith("ed25519:"), errors, "Registry signature keyId must be Ed25519.");
    pushIf(index.signature?.algorithm === "ed25519", errors, "Registry signature algorithm must be ed25519.");
    pushIf(isEd25519Signature(index.signature?.value), errors, "Registry signature value must be a base64 Ed25519 signature.");
  }

  const keyIds = new Set();
  for (const key of Array.isArray(index.publisherKeys) ? index.publisherKeys : []) {
    pushIf(isPlainObject(key), errors, "publisherKeys entries must be objects.");
    pushIf(typeof key?.keyId === "string" && key.keyId.startsWith("ed25519:"), errors, "publisher keyId must be Ed25519.");
    pushIf(key?.algorithm === "ed25519", errors, "publisher key algorithm must be ed25519.");
    pushIf(typeof key?.publicKey === "string" && key.publicKey.length > 0 && key.publicKey.length <= 8192, errors, "publisher publicKey is required.");
    if (key?.keyId) {
      pushIf(!keyIds.has(key.keyId), errors, `Duplicate publisher keyId: ${key.keyId}.`);
      keyIds.add(key.keyId);
    }
  }

  const publisherIds = new Set();
  for (const publisher of Array.isArray(index.publishers) ? index.publishers : []) {
    appendPublisherProfileValidation(publisher, errors);
    if (publisher?.id) {
      pushIf(!publisherIds.has(publisher.id), errors, `Duplicate Registry publisher profile id: ${publisher.id}.`);
      publisherIds.add(publisher.id);
    }
  }

  const pluginIds = new Set();
  for (const plugin of Array.isArray(index.plugins) ? index.plugins : []) {
    pushIf(isPlainObject(plugin), errors, "plugins entries must be objects.");
    pushIf(PLUGIN_ID.test(plugin?.id ?? ""), errors, "Registry plugin id is invalid.");
    pushIf(SEMVER.test(plugin?.latest ?? ""), errors, "Registry plugin latest must be SemVer.");
    pushIf(Array.isArray(plugin?.releases) && plugin.releases.length > 0, errors, "Registry plugin releases are required.");
    for (const releasePath of Array.isArray(plugin?.releases) ? plugin.releases : []) {
      pushIf(isSafeRegistryRelativePath(releasePath) && releasePath.endsWith(".json"), errors, "Registry release paths must be safe relative JSON paths.");
    }
    if (plugin?.id) {
      pushIf(!pluginIds.has(plugin.id), errors, `Duplicate plugin id: ${plugin.id}.`);
      pluginIds.add(plugin.id);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verifies a Registry index against a root key that the source configuration
 * already trusts. A release publisher key is not a substitute for this root.
 */
export function verifyRegistryIndexSignature(index, trustedRoot) {
  const validation = validateRegistryIndex(index);
  if (!validation.valid) return validation;
  if (!isPlainObject(index.signature)) {
    return { valid: false, errors: ["Registry index signature is required for a trusted remote source."] };
  }
  const root = typeof trustedRoot === "string" ? { publicKey: trustedRoot } : trustedRoot;
  if (typeof root?.keyId === "string" && index.signature.keyId !== root.keyId) {
    return { valid: false, errors: ["Registry index signature keyId does not match the trusted root."] };
  }
  if (typeof root?.publicKey !== "string" || root.publicKey.length === 0) {
    return { valid: false, errors: ["Registry root public key is required."] };
  }
  const signature = Buffer.from(index.signature.value, "base64");
  const verified = verifyEd25519(canonicalizeRegistryIndex(index), root.publicKey, signature);
  return verified
    ? { valid: true, errors: [] }
    : { valid: false, errors: ["Registry index signature does not match the trusted root key."] };
}
