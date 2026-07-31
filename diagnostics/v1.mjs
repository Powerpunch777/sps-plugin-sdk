/**
 * Public Diagnostics v1 contract.
 *
 * Diagnostics are evidence, never a log transport. The contract deliberately
 * rejects raw command output, credentials and machine-local paths so a plugin
 * can safely attach its normalized events to a release review.
 */
export const SPS_PLUGIN_DIAGNOSTIC_V1_SCHEMA = "sps-plugin-diagnostic/v1";

export const SPS_PLUGIN_DIAGNOSTIC_ORIGINS = Object.freeze(["core", "desktop", "plugin"]);
export const SPS_PLUGIN_DIAGNOSTIC_CATEGORIES = Object.freeze([
  "manifest", "compatibility", "capability", "worker", "tool", "event",
  "job", "run", "stream", "ui", "connector", "mcp", "migration", "backup",
  "rollback", "visibility",
]);
export const SPS_PLUGIN_DIAGNOSTIC_LEVELS = Object.freeze(["debug", "info", "warn", "error"]);

const ORIGINS = new Set(SPS_PLUGIN_DIAGNOSTIC_ORIGINS);
const CATEGORIES = new Set(SPS_PLUGIN_DIAGNOSTIC_CATEGORIES);
const LEVELS = new Set(SPS_PLUGIN_DIAGNOSTIC_LEVELS);
const EVENT_KEYS = new Set(["schemaVersion", "id", "origin", "category", "level", "code", "message", "occurredAt", "details"]);
const SENSITIVE_KEY = /(?:secret|token|password|credential|authorization|cookie|private.?key|api.?key|access.?key|client.?key|bearer|output|stdout|stderr|command|path|directory|folder|file)/i;
const SECRET_VALUE = /(?:-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|rk|ghp|github_pat|xox[abprs]|AIza)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential|secret)\s*[:=])/i;
const LOCAL_PATH = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|etc|opt|mnt|private|Volumes|root|ProgramData|Windows)(?:[\\/]|$)|~[\\/])/i;
const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,119}$/;
const MAX_DETAIL_DEPTH = 6;
const MAX_DETAIL_KEYS = 64;
const MAX_STRING = 1024;
const MAX_BYTES = 16 * 1024;

export class SpsPluginDiagnosticError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpsPluginDiagnosticError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataEntries(value, label) {
  if (!isPlainObject(value)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must not contain symbol properties.`);
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must not contain accessors or hidden properties.`);
    }
    return [key, descriptor.value];
  });
}

function assertSafeText(value, label, maximum = MAX_STRING) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must be visible text no longer than ${maximum} characters.`);
  }
  if (SECRET_VALUE.test(value) || LOCAL_PATH.test(value) || /^file:/i.test(value)) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_UNSAFE", `${label} must not contain credentials, raw output, or a local path.`);
  }
  return value;
}

function assertStrictIsoTimestamp(value, label) {
  const text = assertSafeText(value, label, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must be a UTC ISO-8601 timestamp with milliseconds.`);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must be a real ISO-8601 timestamp.`);
  }
  return text;
}

function normalizeDetails(value, label, depth, budget, ancestors) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must contain finite numbers.`);
    return value;
  }
  if (typeof value === "string") return assertSafeText(value, label);
  if (depth >= MAX_DETAIL_DEPTH || !value || typeof value !== "object" || ancestors.has(value)) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must be finite, acyclic structured data within the depth limit.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} must be a plain JSON array.`);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} contains an invalid array entry.`);
        result.push(normalizeDetails(descriptor.value, `${label}[${index}]`, depth + 1, budget, ancestors));
      }
      if (Reflect.ownKeys(value).some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= value.length))) {
        throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} contains unsupported array properties.`);
      }
      return Object.freeze(result);
    }
    const result = {};
    for (const [key, child] of dataEntries(value, label)) {
      budget.keys += 1;
      if (budget.keys > MAX_DETAIL_KEYS) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `Diagnostic details exceed ${MAX_DETAIL_KEYS} keys.`);
      if (SENSITIVE_KEY.test(key)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_UNSAFE", `${label}.${key} is not permitted in Diagnostics.`);
      result[key] = normalizeDetails(child, `${label}.${key}`, depth + 1, budget, ancestors);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function assertOnlyKeys(entries, allowed, label) {
  for (const [key] of entries) {
    if (!allowed.has(key)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `${label} contains unsupported property "${key}".`);
  }
}

/** Strictly normalizes one safe, structured diagnostic event. */
export function normalizeSpsPluginDiagnosticEventV1(input) {
  const entries = dataEntries(input, "Diagnostic event");
  assertOnlyKeys(entries, EVENT_KEYS, "Diagnostic event");
  const value = Object.fromEntries(entries);
  if (value.schemaVersion !== undefined && value.schemaVersion !== SPS_PLUGIN_DIAGNOSTIC_V1_SCHEMA) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `schemaVersion must be ${SPS_PLUGIN_DIAGNOSTIC_V1_SCHEMA}.`);
  }
  if (typeof value.id !== "string" || !ID.test(value.id)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", "id must be a lowercase diagnostic identifier.");
  if (!ORIGINS.has(value.origin)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", "origin must be core, desktop, or plugin.");
  if (!CATEGORIES.has(value.category)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `category must be one of ${SPS_PLUGIN_DIAGNOSTIC_CATEGORIES.join(", ")}.`);
  if (!LEVELS.has(value.level)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", "level must be debug, info, warn, or error.");
  if (typeof value.code !== "string" || !CODE.test(value.code)) throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", "code must be an uppercase stable diagnostic code.");
  const occurredAt = assertStrictIsoTimestamp(value.occurredAt, "occurredAt");
  const details = value.details === undefined ? Object.freeze({}) : normalizeDetails(value.details, "details", 0, { keys: 0 }, new Set());
  const result = Object.freeze({
    schemaVersion: SPS_PLUGIN_DIAGNOSTIC_V1_SCHEMA,
    id: value.id,
    origin: value.origin,
    category: value.category,
    level: value.level,
    code: value.code,
    message: assertSafeText(value.message, "message"),
    occurredAt,
    details,
  });
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_BYTES) {
    throw new SpsPluginDiagnosticError("SPS_PLUGIN_DIAGNOSTIC_INVALID", `Diagnostic event exceeds ${MAX_BYTES} bytes.`);
  }
  return result;
}

export function assertSpsPluginDiagnosticEventV1(input) {
  return normalizeSpsPluginDiagnosticEventV1(input);
}

/** Creates a bounded append-only, in-memory event sink for SDK tests. */
export function createSpsPluginDiagnosticSinkV1(options = {}) {
  const maxEvents = options.maxEvents ?? 200;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 1000) throw new TypeError("maxEvents must be an integer between 1 and 1000.");
  const events = [];
  const read = () => Object.freeze(events.slice());
  return Object.freeze({
    get events() { return read(); },
    read,
    emit(input) {
      const event = normalizeSpsPluginDiagnosticEventV1(input);
      events.push(event);
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
      return event;
    },
    clear() { events.splice(0, events.length); },
  });
}
