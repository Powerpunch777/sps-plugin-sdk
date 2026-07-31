import { normalizeSpsPluginDiagnosticEventV1 } from "../diagnostics/v1.mjs";

export const SPS_PLUGIN_CONFORMANCE_V1_SCHEMA = "sps-plugin-conformance/v1";
const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SAFE_TEXT = /(?:[\u0000-\u001f\u007f]|(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|etc|opt|mnt|private|Volumes|root|ProgramData|Windows)(?:[\\/]|$)|~[\\/])|-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|rk|ghp|github_pat|xox[abprs]|AIza)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential|secret)\s*[:=])/i;

function own(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object.`);
  const entries = Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") throw new TypeError(`${label} must not contain symbols.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(`${label} must not contain accessors or hidden properties.`);
    return [key, descriptor.value];
  });
  return Object.fromEntries(entries);
}

function assertIso(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a UTC ISO-8601 timestamp with milliseconds.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new TypeError(`${label} must be a real ISO-8601 timestamp.`);
  return value;
}

function assertSafeText(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || SAFE_TEXT.test(value)) throw new TypeError(`${label} is unsafe.`);
  return value;
}

function normalizeMetadata(value) {
  const metadata = value === undefined ? {} : own(value, "metadata");
  const entries = Object.entries(metadata);
  if (entries.length > 32) throw new TypeError("metadata must contain no more than 32 entries.");
  for (const [key, entry] of entries) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(key)) throw new TypeError("metadata key is invalid.");
    assertSafeText(entry, "metadata value", 256);
  }
  return Object.freeze({ ...metadata });
}

/** Builds immutable release-review evidence from deterministic SDK test output. */
export function createSpsPluginConformanceReportV1(input) {
  const value = own(input, "Conformance report");
  for (const key of Object.keys(value)) if (!["pluginId", "pluginVersion", "generatedAt", "checks", "diagnostics", "metadata"].includes(key)) throw new TypeError(`Conformance report contains unsupported property "${key}".`);
  if (typeof value.pluginId !== "string" || !ID.test(value.pluginId)) throw new TypeError("pluginId must be a safe plugin identifier.");
  if (typeof value.pluginVersion !== "string" || !SEMVER.test(value.pluginVersion)) throw new TypeError("pluginVersion must be a semantic version.");
  const generatedAt = assertIso(value.generatedAt, "generatedAt");
  if (!Array.isArray(value.checks) || value.checks.length === 0 || value.checks.length > 200) throw new TypeError("checks must contain 1 to 200 entries.");
  const seen = new Set();
  const checks = value.checks.map((check) => {
    const item = own(check, "Conformance check");
    if (Object.keys(item).some((key) => !["id", "status", "summary"].includes(key))) throw new TypeError("Conformance check contains unsupported properties.");
    if (typeof item.id !== "string" || !ID.test(item.id) || seen.has(item.id)) throw new TypeError("Conformance check id is invalid or duplicated.");
    seen.add(item.id);
    if (!["passed", "failed", "skipped"].includes(item.status)) throw new TypeError("Conformance check status is invalid.");
    return Object.freeze({ id: item.id, status: item.status, summary: assertSafeText(item.summary, "Conformance check summary", 512) });
  });
  if (value.diagnostics !== undefined && !Array.isArray(value.diagnostics)) throw new TypeError("diagnostics must be an array.");
  const diagnostics = (value.diagnostics ?? []).map(normalizeSpsPluginDiagnosticEventV1);
  if (diagnostics.length > 200) throw new TypeError("diagnostics must contain no more than 200 events.");
  return Object.freeze({
    schemaVersion: SPS_PLUGIN_CONFORMANCE_V1_SCHEMA,
    pluginId: value.pluginId, pluginVersion: value.pluginVersion, generatedAt,
    status: checks.some((check) => check.status === "failed") ? "failed" : checks.every((check) => check.status === "passed") ? "passed" : "incomplete",
    checks: Object.freeze(checks), diagnostics: Object.freeze(diagnostics), metadata: normalizeMetadata(value.metadata),
  });
}
