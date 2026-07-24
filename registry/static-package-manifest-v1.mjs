import { createHash } from "node:crypto";

export const SPS_STATIC_PLUGIN_MANIFEST_VERSION = 1;

const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]{2,127}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isSafeRelativeFilePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !value.includes("\\")
    && !value.includes("\u0000")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function calculateStaticCapabilitiesDigest(capabilities) {
  return createHash("sha256")
    .update(JSON.stringify([...capabilities].sort()), "utf8")
    .digest("hex");
}

/**
 * Validates the declarative metadata used before a Registry package is ever
 * executed. The dynamic Core manifest is verified only during explicit enable.
 */
export function validateStaticPluginManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) return { valid: false, errors: ["sps-plugin.json must contain an object."] };

  if (manifest.schemaVersion !== SPS_STATIC_PLUGIN_MANIFEST_VERSION) {
    errors.push("Unsupported sps-plugin.json schemaVersion.");
  }
  if (!isPlainObject(manifest.plugin)) errors.push("sps-plugin.json plugin must be an object.");
  if (!PLUGIN_ID.test(manifest.plugin?.id ?? "")) errors.push("sps-plugin.json plugin.id is invalid.");
  if (!SEMVER.test(manifest.plugin?.version ?? "")) errors.push("sps-plugin.json plugin.version must be SemVer.");
  if (typeof manifest.plugin?.apiVersion !== "string" || manifest.plugin.apiVersion.trim().length === 0 || manifest.plugin.apiVersion.length > 64) {
    errors.push("sps-plugin.json plugin.apiVersion is required.");
  }

  if (!isPlainObject(manifest.runtime)) errors.push("sps-plugin.json runtime must be an object.");
  if (!isSafeRelativeFilePath(manifest.runtime?.manifestEntry) || !/\.(?:c|m)?js$/i.test(manifest.runtime?.manifestEntry ?? "")) {
    errors.push("sps-plugin.json runtime.manifestEntry must be a safe JavaScript file path.");
  }
  if (!SHA256.test(manifest.runtime?.manifestSha256 ?? "")) errors.push("sps-plugin.json runtime.manifestSha256 must be lowercase SHA-256 hex.");

  if (!Array.isArray(manifest.capabilities)) {
    errors.push("sps-plugin.json capabilities must be an array.");
  } else {
    const seen = new Set();
    for (const capability of manifest.capabilities) {
      if (typeof capability !== "string" || capability.length === 0 || capability.length > 200) {
        errors.push("sps-plugin.json capabilities must contain bounded strings.");
        continue;
      }
      if (seen.has(capability)) errors.push(`Duplicate static capability: ${capability}.`);
      seen.add(capability);
    }
  }
  if (!SHA256.test(manifest.permissionsDigest ?? "")) errors.push("sps-plugin.json permissionsDigest must be lowercase SHA-256 hex.");
  if (Array.isArray(manifest.capabilities) && SHA256.test(manifest.permissionsDigest ?? "")) {
    if (calculateStaticCapabilitiesDigest(manifest.capabilities) !== manifest.permissionsDigest) {
      errors.push("sps-plugin.json permissionsDigest does not match capabilities.");
    }
  }

  return { valid: errors.length === 0, errors };
}
