export const SPS_PLATFORM_CONTRACT_VERSION = "1.0";

export const SPS_PLATFORM_CAPABILITIES = Object.freeze([
  "agent.tools.register",
  "events.subscribe",
  "events.emit",
  "jobs.schedule",
  "plugin.state.read",
  "plugin.state.write",
  "agents.read",
  "agent.sessions.create",
  "agent.sessions.list",
  "agent.sessions.send",
  "agent.sessions.read",
  "agent.sessions.cancel",
  "sps.executions.read",
  "sps.models.read",
  "sps.models.submit",
  "sps.models.cancel",
]);

const CAPABILITY_SET = new Set(SPS_PLATFORM_CAPABILITIES);
const STATE_SCOPE_KINDS = new Set(["instance", "company", "project", "project_workspace", "agent", "issue", "thread", "goal", "run"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyJsonProperties(value) {
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && "value" in descriptor);
  });
}

/** Returns true only for finite, acyclic JSON values backed by plain objects. */
export function isJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || ancestors.has(value)) return false;
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !isJsonValue(descriptor.value, ancestors)) {
        ancestors.delete(value);
        return false;
      }
    }
    const valid = !Reflect.ownKeys(value).some((key) => key !== "length" && (!/^0$|^[1-9][0-9]*$/.test(String(key)) || Number(key) >= value.length));
    ancestors.delete(value);
    return valid;
  }
  if (!isPlainObject(value) || !hasOnlyJsonProperties(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

export function assertJsonValue(value, label = "value") {
  if (!isJsonValue(value)) throw new TypeError(`${label} must be a finite, acyclic plain JSON value.`);
  return value;
}

function assertRecord(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function freezeDeclaration(value) {
  return Object.freeze({ ...value });
}

function assertJsonObject(value, label) {
  assertJsonValue(value, label);
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain JSON object.`);
  return value;
}

/** Validates the declaration passed to Core's tools.register API. */
export function defineTool(name, declaration, handler) {
  const value = assertRecord(declaration, "tool declaration");
  const tool = {
    name: assertNonEmptyString(name, "tool name"),
    declaration: freezeDeclaration({
      displayName: assertNonEmptyString(value.displayName, "tool displayName"),
      description: assertNonEmptyString(value.description, "tool description"),
      parametersSchema: assertJsonObject(value.parametersSchema, "tool parametersSchema"),
    }),
    handler,
  };
  if (typeof tool.handler !== "function") throw new TypeError("tool handler must be a function.");
  return freezeDeclaration(tool);
}

/** Validates either Core events.on(name, handler) overload. */
export function defineEvent(name, filterOrHandler, maybeHandler) {
  const event = { name: assertNonEmptyString(name, "event name") };
  if (maybeHandler === undefined) event.handler = filterOrHandler;
  else {
    event.filter = assertJsonObject(filterOrHandler, "event filter");
    event.handler = maybeHandler;
  }
  if (typeof event.handler !== "function") throw new TypeError("event handler must be a function.");
  return freezeDeclaration(event);
}

/** Validates a Core jobs.register handler for a manifest-declared jobKey. */
export function defineJob(jobKey, handler) {
  const job = { jobKey: assertNonEmptyString(jobKey, "jobKey"), handler };
  if (typeof job.handler !== "function") throw new TypeError("job handler must be a function.");
  return freezeDeclaration(job);
}

/** Declares a read-only UI data provider served through Core's plugin bridge. */
export function defineDataProvider(key, handler) {
  const provider = { key: assertNonEmptyString(key, "data provider key"), handler };
  if (typeof provider.handler !== "function") throw new TypeError("data provider handler must be a function.");
  return freezeDeclaration(provider);
}

/** Validates the exact state key accepted by Core's plugin.state client. */
export function defineSpsStateKey(key) {
  const value = assertRecord(key, "state key");
  if (!STATE_SCOPE_KINDS.has(value.scopeKind)) throw new TypeError("state key scopeKind is unsupported.");
  if (value.scopeId !== undefined) assertNonEmptyString(value.scopeId, "state key scopeId");
  if (value.namespace !== undefined) assertNonEmptyString(value.namespace, "state key namespace");
  return freezeDeclaration({
    scopeKind: value.scopeKind,
    ...(value.scopeId === undefined ? {} : { scopeId: value.scopeId }),
    ...(value.namespace === undefined ? {} : { namespace: value.namespace }),
    stateKey: assertNonEmptyString(value.stateKey, "state key stateKey"),
  });
}

function defineUnique(registrations, toDefinition, identity, label) {
  if (registrations === undefined) return Object.freeze([]);
  if (!Array.isArray(registrations)) throw new TypeError(`${label} must be an array.`);
  const names = new Set();
  const result = registrations.map((registration) => {
    const definition = toDefinition(registration);
    const name = identity(definition);
    if (names.has(name)) throw new TypeError(`${label} contains duplicate name '${name}'.`);
    names.add(name);
    return definition;
  });
  return Object.freeze(result);
}

function defineCapabilities(capabilities) {
  if (capabilities === undefined) return Object.freeze([]);
  if (!Array.isArray(capabilities) || capabilities.some((capability) => typeof capability !== "string")) {
    throw new TypeError("capabilities must be an array of strings.");
  }
  const unique = [...new Set(capabilities)];
  const unsupported = unique.filter((capability) => !CAPABILITY_SET.has(capability));
  if (unsupported.length > 0) throw new TypeError(`Unsupported SPS Platform capabilities: ${unsupported.join(", ")}.`);
  if (unique.length !== capabilities.length) throw new TypeError("capabilities must not contain duplicates.");
  return Object.freeze(unique);
}

/**
 * Declares a workflow-neutral Worker surface. This only validates declarations;
 * an SPS Host must supply registration, dispatch, and state implementations.
 */
export function defineSpsPlatformContract(contract = {}) {
  const value = assertRecord(contract, "Platform contract");
  if (value.contractVersion !== undefined && value.contractVersion !== SPS_PLATFORM_CONTRACT_VERSION) {
    throw new TypeError(`Platform contractVersion must be ${SPS_PLATFORM_CONTRACT_VERSION}.`);
  }
  return Object.freeze({
    contractVersion: SPS_PLATFORM_CONTRACT_VERSION,
    capabilities: defineCapabilities(value.capabilities),
    tools: defineUnique(value.tools, (entry) => {
      const tool = assertRecord(entry, "tool registration");
      return defineTool(tool.name, tool.declaration, tool.handler);
    }, (tool) => tool.name, "tools"),
    events: defineUnique(value.events, (entry) => {
      const event = assertRecord(entry, "event registration");
      return Object.hasOwn(event, "filter")
        ? defineEvent(event.name, event.filter, event.handler)
        : defineEvent(event.name, event.handler);
    }, (event) => event.name, "events"),
    jobs: defineUnique(value.jobs, (entry) => {
      const job = assertRecord(entry, "job registration");
      return defineJob(job.jobKey, job.handler);
    }, (job) => job.jobKey, "jobs"),
    data: defineUnique(value.data, (entry) => {
      const provider = assertRecord(entry, "data provider registration");
      return defineDataProvider(provider.key, provider.handler);
    }, (provider) => provider.key, "data providers"),
    actions: defineUnique(value.actions, (entry) => {
      const action = assertRecord(entry, "action registration");
      return defineDataProvider(action.key, action.handler);
    }, (action) => action.key, "actions"),
  });
}
