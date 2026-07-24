import { validateRegistryIndex, verifyRegistryIndexSignature } from "./release-record-v1.mjs";

export const SPS_REGISTRY_SOURCE_KINDS = new Set(["local", "git", "official"]);

const SOURCE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function validateTrustedRoot(root) {
  const errors = [];
  if (!isPlainObject(root)) return { valid: false, errors: ["trustedRoot must be an object."] };
  if (typeof root.keyId !== "string" || !root.keyId.startsWith("ed25519:") || root.keyId.length > 256) {
    errors.push("trustedRoot.keyId must reference an Ed25519 key.");
  }
  if (typeof root.publicKey !== "string" || root.publicKey.length === 0 || root.publicKey.length > 8192) {
    errors.push("trustedRoot.publicKey is required.");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates Owner-configured Registry sources. Remote sources are pinned to a
 * root key; local folders are an explicit owner-trusted development path.
 */
export function validateRegistrySource(source) {
  const errors = [];
  if (!isPlainObject(source)) return { valid: false, errors: ["Registry source must be an object."] };

  if (!SOURCE_ID.test(source.id ?? "")) errors.push("Registry source id is invalid.");
  if (!SPS_REGISTRY_SOURCE_KINDS.has(source.kind)) errors.push("Registry source kind must be local, git, or official.");
  if (typeof source.displayName !== "string" || source.displayName.trim().length === 0 || source.displayName.length > 200) {
    errors.push("Registry source displayName is required.");
  }

  if (source.kind === "local") {
    if (typeof source.localPath !== "string" || source.localPath.trim().length === 0 || source.localPath.length > 4096) {
      errors.push("Local Registry source localPath is required.");
    }
    if (source.indexUrl !== undefined || source.trustedRoot !== undefined) {
      errors.push("Local Registry sources use an explicit local path and no remote trust root.");
    }
  } else if (source.kind === "git" || source.kind === "official") {
    if (!isHttpsUrl(source.indexUrl)) errors.push("Remote Registry source indexUrl must be an HTTPS URL without credentials or a fragment.");
    const rootValidation = validateTrustedRoot(source.trustedRoot);
    errors.push(...rootValidation.errors);
    if (source.localPath !== undefined) errors.push("Remote Registry sources cannot define localPath.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Applies source policy to an already parsed Registry index. Fetching and
 * package download are intentionally separate from this pure verifier.
 */
export function verifyRegistryIndexForSource(source, index) {
  const sourceValidation = validateRegistrySource(source);
  if (!sourceValidation.valid) return sourceValidation;

  const indexValidation = validateRegistryIndex(index);
  if (!indexValidation.valid) return indexValidation;

  if (source.kind === "local") {
    return {
      valid: true,
      errors: [],
      trust: "explicit-local-owner-trust",
      warning: "Local Registry indexes are trusted only because the Owner explicitly selected this folder.",
    };
  }

  const signatureValidation = verifyRegistryIndexSignature(index, source.trustedRoot);
  return signatureValidation.valid
    ? { valid: true, errors: [], trust: "pinned-remote-root", warning: null }
    : signatureValidation;
}
