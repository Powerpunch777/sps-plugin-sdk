/**
 * Public, read-only Preview fixture contract.
 *
 * The SPS Host may inject this small JSON value into a plugin Preview
 * renderer. It deliberately contains no Host paths, credentials, or runtime
 * handles. Plugins must treat it as representative UI data only.
 */
export const SPS_PLUGIN_PREVIEW_FIXTURE_V1_SCHEMA = "sps-plugin-preview-fixture/v1";
export const SPS_PLUGIN_PREVIEW_FIXTURE_V1_GLOBAL = "__SPS_PLUGIN_PREVIEW_FIXTURE_V1__";

const ROLES = new Set(["host", "member"]);
const VIEWPORTS = new Set(["desktop", "mobile"]);
const UI_STATES = new Set(["live", "empty", "loading", "error"]);
const FIXTURE_NAMES = ["node", "runtime", "source"];
const TOP_LEVEL_KEYS = new Set(["schemaVersion", "role", "fixtures", "viewport", "uiState"]);
const TOGGLE_KEYS = new Set(["enabled", "payload"]);
const SECRET_KEY = /(?:secret|token|password|credential|authorization|cookie|privatekey|apikey|accesskey|clientkey|clientsecret|bearer)/i;
const SECRET_VALUE = /(?:-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|rk|ghp|github_pat|xox[abprs]|AIza)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential|secret)\s*[:=])/i;
const ABSOLUTE_LOCAL_PATH = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|etc|opt|mnt|private|Volumes|root|ProgramData|Windows)(?:[\\/]|$)|~[\\/])/i;
const MAX_PAYLOAD_DEPTH = 8;
const MAX_PAYLOAD_KEYS = 128;
const MAX_STRING_LENGTH = 4096;

export class SpsPluginPreviewFixtureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpsPluginPreviewFixtureError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataEntries(value, label) {
  if (!isPlainObject(value)) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must be a plain object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must not contain symbol properties.`);
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must not contain accessors or hidden properties.`);
    }
    return [key, descriptor.value];
  });
}

function assertOnlyKeys(entries, allowed, label) {
  for (const [key] of entries) {
    if (!allowed.has(key)) {
      throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} contains unsupported property "${key}".`);
    }
  }
}

function assertSafeString(value, label) {
  if (typeof value !== "string" || value.length > MAX_STRING_LENGTH) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must be a string no longer than ${MAX_STRING_LENGTH} characters.`);
  }
  if (SECRET_VALUE.test(value)) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_UNSAFE", `${label} must not contain secret or credential material.`);
  }
  if (ABSOLUTE_LOCAL_PATH.test(value) || /^file:/i.test(value)) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_UNSAFE", `${label} must not contain an absolute local path.`);
  }
  return value;
}

function cloneSafePayload(value, label, depth, budget, ancestors) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must contain only finite JSON numbers.`);
    return value;
  }
  if (typeof value === "string") return assertSafeString(value, label);
  if (depth >= MAX_PAYLOAD_DEPTH || !value || typeof value !== "object" || ancestors.has(value)) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must be a finite, acyclic JSON value within the Preview depth limit.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} must be a plain JSON array.`);
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} contains an invalid array entry.`);
        }
        result.push(cloneSafePayload(descriptor.value, `${label}[${index}]`, depth + 1, budget, ancestors));
      }
      if (Reflect.ownKeys(value).some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= value.length))) {
        throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `${label} contains unsupported array properties.`);
      }
      return Object.freeze(result);
    }

    const entries = ownDataEntries(value, label);
    const result = {};
    for (const [key, child] of entries) {
      budget.keys += 1;
      if (budget.keys > MAX_PAYLOAD_KEYS) {
        throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `Preview fixture payload exceeds ${MAX_PAYLOAD_KEYS} keys.`);
      }
      if (SECRET_KEY.test(key)) {
        throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_UNSAFE", `${label}.${key} must not contain secret or credential material.`);
      }
      result[key] = cloneSafePayload(child, `${label}.${key}`, depth + 1, budget, ancestors);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function normalizeToggle(value, name) {
  if (typeof value === "boolean") return Object.freeze({ enabled: value });
  const entries = ownDataEntries(value, `fixtures.${name}`);
  assertOnlyKeys(entries, TOGGLE_KEYS, `fixtures.${name}`);
  const record = Object.fromEntries(entries);
  if (typeof record.enabled !== "boolean") {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `fixtures.${name}.enabled must be a boolean.`);
  }
  if (record.payload !== undefined && !isPlainObject(record.payload)) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `fixtures.${name}.payload must be a plain JSON object.`);
  }
  return Object.freeze({
    enabled: record.enabled,
    ...(record.payload === undefined ? {} : { payload: cloneSafePayload(record.payload, `fixtures.${name}.payload`, 0, { keys: 0 }, new Set()) }),
  });
}

function defaultFixtures() {
  return Object.freeze({
    node: Object.freeze({ enabled: false }),
    runtime: Object.freeze({ enabled: false }),
    source: Object.freeze({ enabled: false }),
  });
}

/**
 * Strictly validates and normalizes the public Preview fixture value.
 * Unknown fields are rejected so Host metadata, paths, and credentials cannot
 * accidentally become part of a plugin-facing fixture.
 */
export function normalizeSpsPluginPreviewFixtureV1(input = {}) {
  const entries = ownDataEntries(input, "Preview fixture");
  assertOnlyKeys(entries, TOP_LEVEL_KEYS, "Preview fixture");
  const record = Object.fromEntries(entries);
  if (record.schemaVersion !== undefined && record.schemaVersion !== SPS_PLUGIN_PREVIEW_FIXTURE_V1_SCHEMA) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", `schemaVersion must be ${SPS_PLUGIN_PREVIEW_FIXTURE_V1_SCHEMA}.`);
  }
  const role = record.role ?? "host";
  const viewport = record.viewport ?? "desktop";
  const uiState = record.uiState ?? "live";
  if (!ROLES.has(role)) throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", "role must be host or member.");
  if (!VIEWPORTS.has(viewport)) throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", "viewport must be desktop or mobile.");
  if (!UI_STATES.has(uiState)) throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", "uiState must be live, empty, loading, or error.");

  let fixtures = defaultFixtures();
  if (record.fixtures !== undefined) {
    const fixtureEntries = ownDataEntries(record.fixtures, "fixtures");
    assertOnlyKeys(fixtureEntries, new Set(FIXTURE_NAMES), "fixtures");
    const fixtureRecord = Object.fromEntries(fixtureEntries);
    fixtures = Object.freeze(Object.fromEntries(FIXTURE_NAMES.map((name) => [
      name,
      fixtureRecord[name] === undefined ? Object.freeze({ enabled: false }) : normalizeToggle(fixtureRecord[name], name),
    ])));
  }
  return Object.freeze({
    schemaVersion: SPS_PLUGIN_PREVIEW_FIXTURE_V1_SCHEMA,
    role,
    fixtures,
    viewport,
    uiState,
  });
}

export function assertSpsPluginPreviewFixtureV1(input) {
  return normalizeSpsPluginPreviewFixtureV1(input);
}

/**
 * Reads the Host-injected browser global without executing accessors. Missing
 * globals return null; malformed globals fail closed with a typed SDK error.
 */
export function readSpsPluginPreviewFixtureV1(scope = globalThis) {
  if (!scope || (typeof scope !== "object" && typeof scope !== "function")) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", "Preview fixture global scope is invalid.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(scope, SPS_PLUGIN_PREVIEW_FIXTURE_V1_GLOBAL);
  if (!descriptor) return null;
  if (!("value" in descriptor)) {
    throw new SpsPluginPreviewFixtureError("SPS_PLUGIN_PREVIEW_FIXTURE_INVALID", "Preview fixture global must be a data property.");
  }
  return normalizeSpsPluginPreviewFixtureV1(descriptor.value);
}

