import { SPS_CORE_PRIMITIVES } from "../profile/extension-profile-v2.mjs";

/**
 * Public, workflow-neutral Runtime facade for SPS plugins.
 *
 * Its operation names and payloads intentionally match SPS Desktop's Worker
 * RPC protocol. It does not import private Core code or implement transport.
 */
export const SPS_RUNTIME_CONTRACT_VERSION = "1.0";

export const SPS_RUNTIME_OPERATIONS = Object.freeze([
  "sps.workspaceSources.list",
  "sps.runtimes.list",
  "sps.executionGrants.list",
  "sps.executionGrants.upsert",
  "sps.executionGrants.revoke",
  "sps.runs.dispatch",
  "sps.runs.get",
  "sps.runs.listEvents",
  "sps.artifacts.publish",
  "sps.artifacts.list",
]);

const OPERATION_SET = new Set(SPS_RUNTIME_OPERATIONS);
const PRIMITIVE_SET = new Set(SPS_CORE_PRIMITIVES);

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
  return transport.request(operation, input);
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
      listEvents(companyId, runId, options = {}) {
        const input = assertRecord(options, "options");
        return request(clientTransport, "sps.runs.listEvents", {
          companyId: assertNonEmptyString(companyId, "companyId"),
          runId: assertNonEmptyString(runId, "runId"),
          afterSequence: nullableInteger(input.afterSequence, "afterSequence", 0),
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
