import { SPS_CORE_PRIMITIVES } from "../profile/extension-profile-v2.mjs";

/**
 * Public, workflow-neutral Runtime facade for SPS plugins.
 *
 * Its operation names and payloads intentionally match SPS Desktop's Worker
 * RPC protocol. It does not import private Core code or implement transport.
 */
export const SPS_RUNTIME_CONTRACT_VERSION = "1.0";

export const SPS_RUNTIME_OPERATIONS = Object.freeze([
  "sps.executions.list",
  "sps.executions.get",
  "sps.executions.summarize",
  "sps.workspaceSources.list",
  "sps.runtimes.list",
  "sps.executionGrants.list",
  "sps.executionGrants.upsert",
  "sps.executionGrants.revoke",
  "sps.runs.dispatch",
  "sps.runs.get",
  "sps.runs.list",
  "sps.runs.listEvents",
  "sps.runs.cancel",
  "sps.artifacts.publish",
  "sps.artifacts.list",
]);

const OPERATION_SET = new Set(SPS_RUNTIME_OPERATIONS);
const PRIMITIVE_SET = new Set(SPS_CORE_PRIMITIVES);
const EXECUTION_LANES = new Set(["node", "agent_session"]);
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CANONICAL_UTC_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function assertString(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

function assertNonEmptyString(value, label) {
  const text = assertString(value, label);
  if (text.trim().length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return text;
}

function assertExecutionLane(value, label = "lane") {
  if (!EXECUTION_LANES.has(value)) throw new TypeError(`${label} must be "node" or "agent_session".`);
  return value;
}

function assertUuid(value, label) {
  const text = assertString(value, label);
  if (!UUID_PATTERN.test(text)) throw new TypeError(`${label} must be a UUID.`);
  return text;
}

function assertCanonicalUtcMillis(value, label) {
  const text = assertString(value, label);
  if (!CANONICAL_UTC_MILLIS_PATTERN.test(text)) {
    throw new TypeError(`${label} must be a canonical ISO timestamp with milliseconds in UTC.`);
  }
  try {
    if (new Date(text).toISOString() !== text) throw new Error("not canonical");
  } catch {
    throw new TypeError(`${label} must be a canonical ISO timestamp with milliseconds in UTC.`);
  }
  return text;
}

function assertExecutionCursor(value) {
  const cursor = assertRecord(value, "before");
  const allowedKeys = new Set(["createdAt", "runId", "lane"]);
  if (Object.keys(cursor).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("before must contain only createdAt, runId, and lane.");
  }
  return {
    createdAt: assertCanonicalUtcMillis(cursor.createdAt, "before.createdAt"),
    runId: assertUuid(cursor.runId, "before.runId"),
    lane: assertExecutionLane(cursor.lane, "before.lane"),
  };
}

function nullableString(value, label) {
  if (value === undefined || value === null) return value;
  return assertString(value, label);
}

function isJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    const valid = value.every((entry) => isJsonValue(entry, ancestors));
    ancestors.delete(value);
    return valid;
  }
  if (!isRecord(value) || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function assertJsonRecord(value, label) {
  assertRecord(value, label);
  if (!isJsonValue(value)) throw new TypeError(`${label} must contain only JSON-serializable values.`);
  return value;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be an array of strings.`);
  }
  return value;
}

function assertStringRecord(value, label) {
  assertRecord(value, label);
  if (Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must map strings to strings.`);
  }
  return value;
}

function nullableInteger(value, label, minimum) {
  if (value === undefined || value === null) return value;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer greater than or equal to ${minimum}, null, or undefined.`);
  }
  return value;
}

function optionalBoundedInteger(value, label, minimum, maximum) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum} when provided.`);
  }
  return value;
}

function assertHttpsReference(value) {
  if (value === undefined || value === null) return value;
  const text = assertString(value, "referenceUrl");
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("unsafe");
    return url.toString();
  } catch {
    throw new TypeError("referenceUrl must be an absolute https URL without credentials or a fragment.");
  }
}

function validateTransport(transport) {
  if (!isRecord(transport) || typeof transport.request !== "function") {
    throw new TypeError("SPS Runtime transport must provide request(operation, input).");
  }
  return transport;
}

function request(transport, operation, input) {
  if (!OPERATION_SET.has(operation)) throw new TypeError(`Unsupported SPS Runtime operation: ${String(operation)}.`);
  const payload = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  if (!isJsonValue(payload)) {
    throw new TypeError(`SPS Runtime ${operation} input must contain only JSON-serializable values.`);
  }
  return transport.request(operation, payload);
}

/**
 * Creates the finite client surface available to a plugin Worker.
 *
 * The injected transport is supplied by SPS Desktop. Each method constructs
 * the exact existing Worker RPC payload, so an adapter can forward it without
 * translating a second SDK-specific wire protocol.
 */
export function createSpsRuntimeClient(transport) {
  const clientTransport = validateTransport(transport);

  return Object.freeze({
    contractVersion: SPS_RUNTIME_CONTRACT_VERSION,
    executions: Object.freeze({
      list(companyId, options = {}) {
        const input = assertRecord(options, "options");
        const limit = optionalBoundedInteger(input.limit, "limit", 1, 100);
        return request(clientTransport, "sps.executions.list", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          lane: input.lane === undefined ? undefined : assertExecutionLane(input.lane),
          limit,
          before: input.before === undefined ? undefined : assertExecutionCursor(input.before),
        });
      },
      get(companyId, lane, runId) {
        return request(clientTransport, "sps.executions.get", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          lane: assertExecutionLane(lane),
          runId: assertUuid(runId, "runId"),
        });
      },
      summarize(companyId, options) {
        const input = assertRecord(options, "options");
        const allowedKeys = new Set(["from", "to", "lane", "agentId"]);
        if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
          throw new TypeError("options must contain only from, to, lane, and agentId.");
        }
        const from = assertCanonicalUtcMillis(input.from, "from");
        const to = assertCanonicalUtcMillis(input.to, "to");
        const fromMs = Date.parse(from);
        const toMs = Date.parse(to);
        if (fromMs >= toMs) throw new TypeError("to must be later than from.");
        if (toMs - fromMs > 31 * 24 * 60 * 60 * 1000) {
          throw new TypeError("from and to must span no more than 31 days.");
        }
        const lane = input.lane === undefined ? undefined : assertExecutionLane(input.lane);
        const agentId = input.agentId === undefined ? undefined : assertUuid(input.agentId, "agentId");
        if (agentId !== undefined && lane === "node") {
          throw new TypeError('agentId cannot be combined with lane "node".');
        }
        return request(clientTransport, "sps.executions.summarize", {
          companyId: assertUuid(companyId, "companyId"),
          from,
          to,
          lane,
          agentId,
        });
      },
    }),
    workspaceSources: Object.freeze({
      list(companyId) {
        return request(clientTransport, "sps.workspaceSources.list", { companyId: assertNonEmptyString(companyId, "companyId") });
      },
    }),
    runtimes: Object.freeze({
      list(companyId, options = {}) {
        const input = assertRecord(options, "options");
        return request(clientTransport, "sps.runtimes.list", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          nodeId: nullableString(input.nodeId, "nodeId"),
        });
      },
    }),
    executionGrants: Object.freeze({
      list(companyId, options = {}) {
        const input = assertRecord(options, "options");
        if (input.includeRevoked !== undefined && typeof input.includeRevoked !== "boolean") {
          throw new TypeError("includeRevoked must be a boolean or undefined.");
        }
        return request(clientTransport, "sps.executionGrants.list", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          subjectKey: nullableString(input.subjectKey, "subjectKey"),
          includeRevoked: input.includeRevoked,
        });
      },
      upsert(input) {
        const value = assertRecord(input, "execution grant input");
        return request(clientTransport, "sps.executionGrants.upsert", {
          companyId: assertNonEmptyString(value.companyId, "companyId"),
          subjectKey: assertNonEmptyString(value.subjectKey, "subjectKey"),
          nodeId: assertNonEmptyString(value.nodeId, "nodeId"),
          runnerProfileId: assertNonEmptyString(value.runnerProfileId, "runnerProfileId"),
          workspaceSourceId: nullableString(value.workspaceSourceId, "workspaceSourceId"),
        });
      },
      revoke(companyId, grantId) {
        return request(clientTransport, "sps.executionGrants.revoke", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          grantId: assertNonEmptyString(grantId, "grantId"),
        });
      },
    }),
    runs: Object.freeze({
      dispatch(input) {
        const value = assertRecord(input, "run dispatch input");
        return request(clientTransport, "sps.runs.dispatch", {
          companyId: assertNonEmptyString(value.companyId, "companyId"),
          executionGrantId: assertNonEmptyString(value.executionGrantId, "executionGrantId"),
          args: assertStringArray(value.args, "args"),
          env: value.env === undefined ? undefined : assertStringRecord(value.env, "env"),
          stdin: nullableString(value.stdin, "stdin"),
          timeoutMs: nullableInteger(value.timeoutMs, "timeoutMs", 0),
        });
      },
      get(companyId, runId) {
        return request(clientTransport, "sps.runs.get", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          runId: assertNonEmptyString(runId, "runId"),
        });
      },
      list(companyId, options = {}) {
        const input = assertRecord(options, "options");
        const limit = nullableInteger(input.limit, "limit", 1);
        if (limit !== undefined && limit !== null && limit > 200) {
          throw new TypeError("limit must be less than or equal to 200.");
        }
        return request(clientTransport, "sps.runs.list", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          subjectKey: nullableString(input.subjectKey, "subjectKey"),
          status: nullableString(input.status, "status"),
          limit,
          beforeId: nullableString(input.beforeId, "beforeId"),
        });
      },
      listEvents(companyId, runId, options = {}) {
        const input = assertRecord(options, "options");
        return request(clientTransport, "sps.runs.listEvents", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          runId: assertNonEmptyString(runId, "runId"),
          afterSequence: nullableInteger(input.afterSequence, "afterSequence", 0),
        });
      },
      cancel(companyId, runId) {
        return request(clientTransport, "sps.runs.cancel", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          runId: assertNonEmptyString(runId, "runId"),
        });
      },
    }),
    artifacts: Object.freeze({
      publish(input) {
        const value = assertRecord(input, "artifact input");
        return request(clientTransport, "sps.artifacts.publish", {
          companyId: assertNonEmptyString(value.companyId, "companyId"),
          subjectKey: assertNonEmptyString(value.subjectKey, "subjectKey"),
          runId: nullableString(value.runId, "runId"),
          title: assertNonEmptyString(value.title, "title"),
          kind: nullableString(value.kind, "kind"),
          referenceUrl: assertHttpsReference(value.referenceUrl),
          summary: nullableString(value.summary, "summary"),
          data: value.data === undefined ? undefined : assertJsonRecord(value.data, "data"),
        });
      },
      list(companyId, options = {}) {
        const input = assertRecord(options, "options");
        return request(clientTransport, "sps.artifacts.list", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          subjectKey: nullableString(input.subjectKey, "subjectKey"),
          runId: nullableString(input.runId, "runId"),
          limit: nullableInteger(input.limit, "limit", 1),
        });
      },
    }),
  });
}

/**
 * Produces the canonical Extension Profile 2.0 Core declaration.
 * Unsupported primitives and dependency violations fail before packaging.
 */
export function defineSpsRuntimeContract(contract = {}) {
  const value = assertRecord(contract, "Runtime contract");
  if (value.contractVersion !== undefined && value.contractVersion !== "2.0") {
    throw new TypeError("Runtime contractVersion must be 2.0.");
  }
  const primitives = value.primitives === undefined ? [] : value.primitives;
  if (!Array.isArray(primitives) || primitives.some((primitive) => typeof primitive !== "string")) {
    throw new TypeError("Runtime contract primitives must be an array of strings.");
  }
  const unsupported = primitives.filter((primitive) => !PRIMITIVE_SET.has(primitive));
  if (unsupported.length > 0) throw new TypeError(`Unsupported SPS Core primitives: ${[...new Set(unsupported)].join(", ")}.`);
  const duplicates = primitives.filter((primitive, index) => primitives.indexOf(primitive) !== index);
  if (duplicates.length > 0) throw new TypeError(`Duplicate SPS Core primitives: ${[...new Set(duplicates)].join(", ")}.`);
  if (primitives.includes("workspace.sources.route") && !primitives.includes("workspace.sources.metadata")) {
    throw new TypeError("workspace.sources.route requires workspace.sources.metadata.");
  }
  if (primitives.includes("runtimes.dispatch") && !primitives.includes("runtimes.list")) {
    throw new TypeError("runtimes.dispatch requires runtimes.list.");
  }
  return Object.freeze({ contractVersion: "2.0", primitives: Object.freeze([...primitives]) });
}
