const HOST_OPERATIONS = [
  "agents.describeExecution",
  "agents.list",
  "agents.sessions.cancel",
  "agents.sessions.create",
  "agents.sessions.getRun",
  "agents.sessions.list",
  "agents.sessions.sendMessage",
  "sps.artifacts.list",
  "sps.artifacts.publish",
  "sps.executionGrants.list",
  "sps.executionGrants.revoke",
  "sps.executionGrants.upsert",
  "sps.executions.get",
  "sps.executions.list",
  "sps.executions.summarize",
  "sps.models.cancel",
  "sps.models.get",
  "sps.models.list",
  "sps.models.submit",
  "sps.runs.cancel",
  "sps.runs.dispatch",
  "sps.runs.get",
  "sps.runs.list",
  "sps.runs.listEvents",
  "sps.runtimes.list",
  "sps.workspaceSources.list",
];

export const SPS_HOST_OPERATIONS = Object.freeze(HOST_OPERATIONS);

const HOST_OPERATION_SET = new Set(SPS_HOST_OPERATIONS);
const OPERATION_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;
function unknownSupport() {
  return Object.freeze({
    state: "unknown",
    contractVersion: null,
    operations: Object.freeze([]),
  });
}

function isObject(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function assertPlainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must not have a custom prototype.`);
  }
}

function ownDataDescriptor(record, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`${label}.${key} must be an own data property.`);
  }
  return descriptor;
}

function assertExactHostKeys(host) {
  const keys = Reflect.ownKeys(host);
  if (keys.length !== 2 || !keys.includes("contractVersion") || !keys.includes("operations")) {
    throw new TypeError("spsHost must contain only contractVersion and operations.");
  }
  for (const key of keys) {
    ownDataDescriptor(host, key, "spsHost");
  }
}

function readOperations(value) {
  if (!Array.isArray(value)) throw new TypeError("spsHost.operations must be an array.");
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("spsHost.operations must be a plain array.");
  }

  const lengthDescriptor = ownDataDescriptor(value, "length", "spsHost.operations");
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 128) {
    throw new TypeError("spsHost.operations must contain no more than 128 entries.");
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => key === "length" ? false : typeof key !== "string")) {
    throw new TypeError("spsHost.operations must be a dense array without extra properties.");
  }

  const seen = new Set();
  const recognized = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = ownDataDescriptor(value, String(index), "spsHost.operations");
    const operation = descriptor.value;
    if (typeof operation !== "string") {
      throw new TypeError("spsHost.operations entries must be strings.");
    }
    if (operation.length > 80 || !OPERATION_PATTERN.test(operation)) {
      throw new TypeError("spsHost.operations entries must be dotted identifiers of at most 80 characters.");
    }
    if (seen.has(operation)) throw new TypeError(`Duplicate spsHost operation: ${operation}.`);
    seen.add(operation);
    if (HOST_OPERATION_SET.has(operation)) recognized.push(operation);
  }

  recognized.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return Object.freeze(recognized);
}

/** Reads only a bounded, explicit Host RPC-handler report from initialize params. */
export function readSpsHostSupport(initializeParams) {
  if (!isObject(initializeParams)) return unknownSupport();
  const hostDescriptor = Object.getOwnPropertyDescriptor(initializeParams, "spsHost");
  if (!hostDescriptor || !("value" in hostDescriptor)) return unknownSupport();

  const host = hostDescriptor.value;
  assertPlainRecord(host, "spsHost");

  const contractVersion = ownDataDescriptor(host, "contractVersion", "spsHost").value;
  if (typeof contractVersion !== "string") {
    throw new TypeError("spsHost.contractVersion must be a string.");
  }
  if (contractVersion !== "1.0") return unknownSupport();

  assertExactHostKeys(host);
  const operations = readOperations(ownDataDescriptor(host, "operations", "spsHost").value);
  return Object.freeze({ state: "reported", contractVersion: "1.0", operations });
}
