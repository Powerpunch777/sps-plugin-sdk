import { createInterface } from "node:readline";
import { AsyncLocalStorage } from "node:async_hooks";
import { SPS_RUNTIME_OPERATIONS } from "../runtime/index.mjs";

const RUNTIME_OPERATION_SET = new Set(SPS_RUNTIME_OPERATIONS);
const LIFECYCLE_METHODS = new Set(["initialize", "health", "shutdown"]);
const PLATFORM_METHODS = new Set(["executeTool", "onEvent", "runJob", "getData", "performAction"]);
const PLATFORM_AGENT_OPERATIONS = Object.freeze({
  "agents.list": "agents.read",
  "agents.describeExecution": "agents.read",
  "agents.sessions.create": "agent.sessions.create",
  "agents.sessions.list": "agent.sessions.list",
  "agents.sessions.sendMessage": "agent.sessions.send",
  "agents.sessions.getRun": "agent.sessions.read",
  "agents.sessions.cancel": "agent.sessions.cancel",
});
const MODEL_OPERATION_CAPABILITIES = Object.freeze({
  "sps.models.list": "sps.models.read",
  "sps.models.submit": "sps.models.submit",
  "sps.models.get": "sps.models.read",
  "sps.models.cancel": "sps.models.cancel",
});
const PLATFORM_HOST_OPERATIONS = new Set([
  "state.get", "state.set", "state.delete", "events.emit", "events.subscribe",
  "inbox.publish", "inbox.update", "inbox.withdraw",
  ...Object.keys(PLATFORM_AGENT_OPERATIONS),
]);
const EXECUTION_READ_OPERATIONS = new Set(["sps.executions.list", "sps.executions.get", "sps.executions.summarize"]);
const JSON_RPC_VERSION = "2.0";
const SURFACE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MODEL_UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MODEL_REQUEST_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_INPUT_MAX_BYTES = 65_536;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactPlainDataRecord(value, label, allowedKeys) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  const allowed = new Set(allowedKeys);
  if (keys.length !== allowed.size || keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError(`${label} must contain only ${allowedKeys.join(", ")}.`);
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable own data property.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function normalizeModelUuid(value, label) {
  if (typeof value !== "string" || value.length !== 36 || !MODEL_UUID_RE.test(value)) throw new TypeError(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function normalizeModelRequest(operation, value) {
  if (operation === "sps.models.list") {
    const input = exactPlainDataRecord(value, "model list input", ["companyId"]);
    return { companyId: normalizeModelUuid(input.companyId, "companyId") };
  }
  if (operation === "sps.models.submit") {
    const input = exactPlainDataRecord(value, "model request input", ["companyId", "connectionId", "requestKey", "input"]);
    const requestText = input.input;
    if (typeof requestText !== "string" || requestText.trim().length === 0 || requestText.length > MODEL_INPUT_MAX_BYTES ||
      new TextEncoder().encode(requestText).byteLength > MODEL_INPUT_MAX_BYTES) {
      throw new TypeError("input must be a non-empty string of at most 65536 UTF-8 bytes.");
    }
    if (typeof input.requestKey !== "string" || input.requestKey.length > 128 || /[\r\n\u2028\u2029]/.test(input.requestKey) || !MODEL_REQUEST_KEY_RE.test(input.requestKey)) {
      throw new TypeError("requestKey must match /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.");
    }
    return {
      companyId: normalizeModelUuid(input.companyId, "companyId"),
      connectionId: normalizeModelUuid(input.connectionId, "connectionId"),
      requestKey: input.requestKey,
      input: requestText,
    };
  }
  const input = exactPlainDataRecord(value, "model run input", ["companyId", "runId"]);
  return {
    companyId: normalizeModelUuid(input.companyId, "companyId"),
    runId: normalizeModelUuid(input.runId, "runId"),
  };
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

function error(code, message, data) {
  const value = { code, message };
  if (data !== undefined) value.data = data;
  return value;
}

function toError(value, fallback = "Worker request failed.") {
  if (value instanceof Error) return value;
  if (isRecord(value) && typeof value.message === "string") return Object.assign(new Error(value.message), { code: value.code, data: value.data });
  return new Error(fallback);
}

function validateHandlers(handlers) {
  if (!isRecord(handlers)) throw new TypeError("SPS Worker definition must be an object.");
  const result = {};
  for (const method of LIFECYCLE_METHODS) {
    if (handlers[method] !== undefined && typeof handlers[method] !== "function") {
      throw new TypeError(`SPS Worker ${method} handler must be a function.`);
    }
    if (typeof handlers[method] === "function") result[method] = handlers[method];
  }
  const platform = handlers.platform;
  if (platform !== undefined && (!isRecord(platform) || platform.contractVersion !== "1.0" || !Array.isArray(platform.tools) || !Array.isArray(platform.events) || !Array.isArray(platform.jobs) || !Array.isArray(platform.data))) {
    throw new TypeError("SPS Worker platform must be a defineSpsPlatformContract result.");
  }
  return Object.freeze({ ...result, ...(platform === undefined ? {} : { platform }) });
}

/**
 * Declares the small portable Worker lifecycle. The workflow itself belongs to
 * the plugin; this contract only covers Host initialization, health, shutdown,
 * finite SPS Runtime requests, and an optional declared platform surface.
 */
export function defineSpsPlugin(handlers) {
  return Object.freeze({ handlers: validateHandlers(handlers) });
}

function normalizePlugin(plugin) {
  if (isRecord(plugin) && isRecord(plugin.handlers)) return plugin;
  return defineSpsPlugin(plugin);
}

/**
 * Runs a newline-delimited JSON-RPC 2.0 Worker over stdin/stdout.
 * stdout is reserved exclusively for protocol messages; diagnostics use stderr.
 */
export function runSpsWorker(plugin, options = {}) {
  const definition = normalizePlugin(plugin);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const logger = options.logger ?? ((message) => process.stderr.write(`${message}\n`));
  if (!input || typeof input.on !== "function") throw new TypeError("SPS Worker input must be a readable stream.");
  if (!output || typeof output.write !== "function") throw new TypeError("SPS Worker output must be a writable stream.");
  if (typeof logger !== "function") throw new TypeError("SPS Worker logger must be a function.");

  let nextRequestId = 1;
  let closed = false;
  let lifecycleState = "new";
  const pending = new Map();
  const sessionCallbacks = new Map();
  const invocationStorage = new AsyncLocalStorage();
  const agentTenantStorage = new AsyncLocalStorage();
  const controller = new AbortController();
  let resolveClosed;
  const closedPromise = new Promise((resolve) => { resolveClosed = resolve; });

  function write(message) {
    if (closed) throw new Error("SPS Worker transport is closed.");
    if (!isJsonValue(message)) throw new TypeError("SPS Worker protocol messages must be JSON values.");
    output.write(`${JSON.stringify(message)}\n`);
  }

  function close(reason = new Error("SPS Worker transport closed.")) {
    if (closed) return;
    closed = true;
    controller.abort(reason);
    for (const { reject } of pending.values()) reject(reason);
    pending.clear();
    sessionCallbacks.clear();
    reader.close();
    input.pause?.();
    resolveClosed();
  }

  function callHost(operation, inputValue) {
    if (!RUNTIME_OPERATION_SET.has(operation) && !PLATFORM_HOST_OPERATIONS.has(operation)) {
      return Promise.reject(new TypeError(`Unsupported SPS Worker-to-Host operation: ${String(operation)}.`));
    }
    if (!isJsonValue(inputValue)) {
      return Promise.reject(new TypeError("SPS Worker request input must be JSON-serializable."));
    }
    if (closed) return Promise.reject(new Error("SPS Worker transport is closed."));
    const id = `sps-${nextRequestId++}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        const invocation = invocationStorage.getStore();
        write({ jsonrpc: JSON_RPC_VERSION, id, method: operation, params: inputValue, ...(invocation ? { paperclipInvocationId: invocation.id } : {}) });
      } catch (cause) {
        pending.delete(id);
        reject(toError(cause));
      }
    });
  }

  const spsTransport = Object.freeze({
    request(operation, inputValue) {
      if (!RUNTIME_OPERATION_SET.has(operation)) {
        return Promise.reject(new TypeError(`Unsupported SPS Runtime operation: ${String(operation)}.`));
      }
      const modelCapability = MODEL_OPERATION_CAPABILITIES[operation];
      if (modelCapability) {
        if (!definition.handlers.platform?.capabilities.includes(modelCapability)) {
          return Promise.reject(new Error(`Undeclared SPS Platform capability: ${modelCapability}.`));
        }
        if (lifecycleState !== "ready") {
          return Promise.reject(new Error("SPS model access requires an authenticated invocation company."));
        }
        const invocation = invocationStorage.getStore();
        if (!invocation || typeof invocation.scope?.companyId !== "string") {
          return Promise.reject(new Error("SPS model access must match the authenticated invocation company."));
        }
        let normalizedInput;
        let invocationCompanyId;
        try {
          normalizedInput = normalizeModelRequest(operation, inputValue);
          invocationCompanyId = normalizeModelUuid(invocation.scope.companyId, "authenticated invocation company");
        } catch (cause) {
          return Promise.reject(cause);
        }
        const tenant = agentTenantStorage.getStore();
        let tenantCompanyId = invocationCompanyId;
        try {
          if (typeof tenant?.companyId === "string") tenantCompanyId = normalizeModelUuid(tenant.companyId, "invocation tenant company");
          if (typeof tenant?.invocationCompanyId === "string" &&
            normalizeModelUuid(tenant.invocationCompanyId, "authenticated invocation company") !== invocationCompanyId) {
            return Promise.reject(new Error("SPS model access must match the authenticated invocation company."));
          }
        } catch (cause) {
          return Promise.reject(cause);
        }
        if (normalizedInput.companyId !== invocationCompanyId || tenantCompanyId !== invocationCompanyId) {
          return Promise.reject(new Error("SPS model access must match the authenticated invocation company."));
        }
        return callHost(operation, normalizedInput);
      }
      if (EXECUTION_READ_OPERATIONS.has(operation)) {
        const requestedCompanyId = isRecord(inputValue) ? inputValue.companyId : undefined;
        const invocationCompanyId = invocationStorage.getStore()?.scope?.companyId;
        if (typeof requestedCompanyId !== "string" || requestedCompanyId.length === 0 ||
          typeof invocationCompanyId !== "string" || invocationCompanyId.length === 0 ||
          requestedCompanyId !== invocationCompanyId) {
          return Promise.reject(new Error("SPS execution access must match the authenticated invocation company."));
        }
      }
      return callHost(operation, inputValue);
    },
  });

  function agentRequest(operation, params, requireTenant = false) {
    const capability = Object.hasOwn(PLATFORM_AGENT_OPERATIONS, operation) ? PLATFORM_AGENT_OPERATIONS[operation] : undefined;
    if (!capability) {
      return Promise.reject(new TypeError(`Unsupported SPS Agent operation: ${String(operation)}.`));
    }
    if (!definition.handlers.platform?.capabilities.includes(capability)) {
      return Promise.reject(new Error(`Undeclared SPS Platform capability: ${capability}.`));
    }
    if (requireTenant) {
      const tenant = agentTenantStorage.getStore();
      const companyId = typeof tenant?.companyId === "string" ? tenant.companyId : tenant?.invocationCompanyId;
      if (typeof companyId !== "string" || companyId.length === 0 || params.companyId !== companyId ||
        (typeof tenant?.companyId === "string" && typeof tenant?.invocationCompanyId === "string" && tenant.companyId !== tenant.invocationCompanyId)) {
        return Promise.reject(new Error("SPS Agent access must match the authenticated invocation company."));
      }
    }
    return callHost(operation, params);
  }
  function boundedAgentString(value, label) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 160) {
      throw new TypeError(`${label} must be a non-empty string of at most 160 characters.`);
    }
    return value;
  }
  function withAgentTenant(companyId, handler) {
    const invocationCompanyId = invocationStorage.getStore()?.scope?.companyId;
    return agentTenantStorage.run({ companyId, invocationCompanyId }, handler);
  }
  const platform = Object.freeze({
    agents: Object.freeze({
      list(input) { return agentRequest("agents.list", input); },
      describeExecution(agentId, companyId) {
        try {
          return agentRequest("agents.describeExecution", {
            agentId: boundedAgentString(agentId, "agentId"),
            companyId: boundedAgentString(companyId, "companyId"),
          }, true);
        } catch (cause) {
          return Promise.reject(cause);
        }
      },
      sessions: Object.freeze({
        create(agentId, companyId, options = {}) { return agentRequest("agents.sessions.create", { ...options, agentId, companyId }); },
        list(agentId, companyId) { return agentRequest("agents.sessions.list", { agentId, companyId }); },
        async sendMessage(sessionId, companyId, options) {
          if (options.onEvent) sessionCallbacks.set(sessionId, options.onEvent);
          try {
            return await agentRequest("agents.sessions.sendMessage", { sessionId, companyId, prompt: options.prompt, ...(options.reason ? { reason: options.reason } : {}) });
          } catch (error) { sessionCallbacks.delete(sessionId); throw error; }
        },
        getRun(sessionId, companyId, runId) { return agentRequest("agents.sessions.getRun", { sessionId, companyId, runId }, true); },
        cancel(sessionId, companyId, runId) { return agentRequest("agents.sessions.cancel", { sessionId, companyId, runId }, true); },
      }),
    }),
    events: Object.freeze({
      emit(name, companyId, payload) {
        if (typeof name !== "string" || name.length === 0 || typeof companyId !== "string" || companyId.length === 0 || !isJsonValue(payload)) {
          return Promise.reject(new TypeError("SPS Platform event emission must use non-empty names and JSON payloads."));
        }
        return callHost("events.emit", { name, companyId, payload });
      },
    }),
    state: Object.freeze({
      get(key) { return callHost("state.get", validateStateKey(key)); },
      set(key, value) {
        if (!isJsonValue(value)) return Promise.reject(new TypeError("SPS Platform state values must be JSON-serializable."));
        return callHost("state.set", { ...validateStateKey(key), value });
      },
      delete(key) { return callHost("state.delete", validateStateKey(key)); },
    }),
  });

  function inboxString(value, label, maxLength) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
      throw new TypeError(`${label} must be between 1 and ${maxLength} characters.`);
    }
    return value.trim();
  }

  function assertSafeNavigationTarget(value) {
    const target = inboxString(value, "SPS Inbox navigationTarget", 500);
    if (!target.startsWith("/") || target.startsWith("//") || target.includes("..")) {
      throw new TypeError("SPS Inbox navigationTarget must be a safe absolute SPS route.");
    }
    return target;
  }

  function validateInboxActionId(value) {
    const id = inboxString(value, "SPS Inbox action id", 100);
    if (!SURFACE_ID_RE.test(id)) throw new TypeError("SPS Inbox action ids must use lowercase letters, numbers, dots, underscores, or hyphens.");
    return id;
  }

  function validateInboxItem(input) {
    if (!isRecord(input) || typeof input.companyId !== "string" || input.companyId.trim().length === 0 ||
      (input.targetUserId !== undefined && input.targetUserId !== null && (typeof input.targetUserId !== "string" || input.targetUserId.trim().length === 0)) ||
      (input.severity !== undefined && !["info", "success", "warning", "error"].includes(input.severity)) ||
      (input.actionIds !== undefined && !Array.isArray(input.actionIds)) ||
      (input.opaqueReference !== undefined && (!isRecord(input.opaqueReference) || !isJsonValue(input.opaqueReference)))) {
      throw new TypeError("SPS Inbox entries require a company, JSON-safe optional fields, and a supported severity.");
    }
    if (
      input.opaqueReference !== undefined
      && new TextEncoder().encode(JSON.stringify(input.opaqueReference)).byteLength > 32_768
    ) {
      throw new TypeError("SPS Inbox opaqueReference must not exceed 32 KiB.");
    }
    const externalId = inboxString(input.externalId, "SPS Inbox externalId", 200);
    const category = inboxString(input.category, "SPS Inbox category", 100);
    const title = inboxString(input.title, "SPS Inbox title", 200);
    const summary = inboxString(input.summary, "SPS Inbox summary", 2000);
    const actionIds = input.actionIds === undefined
      ? undefined
      : [...new Set(input.actionIds.map(validateInboxActionId))];
    const navigationTarget = input.navigationTarget === undefined || input.navigationTarget === null
      ? input.navigationTarget
      : assertSafeNavigationTarget(input.navigationTarget);
    return {
      companyId: input.companyId.trim(),
      externalId,
      ...(input.targetUserId === undefined
        ? {}
        : { targetUserId: input.targetUserId === null ? null : input.targetUserId.trim() }),
      category,
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      title,
      summary,
      ...(input.navigationTarget === undefined ? {} : { navigationTarget }),
      ...(actionIds === undefined ? {} : { actionIds }),
      ...(input.opaqueReference === undefined ? {} : { opaqueReference: input.opaqueReference }),
    };
  }

  function validateInboxKey(input) {
    if (!isRecord(input) || typeof input.companyId !== "string" || input.companyId.trim().length === 0) {
      throw new TypeError("SPS Inbox keys require non-empty companyId and externalId.");
    }
    return {
      companyId: input.companyId.trim(),
      externalId: inboxString(input.externalId, "SPS Inbox externalId", 200),
    };
  }

  const inbox = Object.freeze({
    async publish(input) {
      const result = await callHost("inbox.publish", validateInboxItem(input));
      if (!isRecord(result) || typeof result.id !== "string" || typeof result.externalId !== "string") {
        throw new TypeError("SPS Host returned an invalid Inbox publish result.");
      }
      return { id: result.id, externalId: result.externalId };
    },
    async update(input) {
      const result = await callHost("inbox.update", validateInboxItem(input));
      if (!isRecord(result) || typeof result.id !== "string" || typeof result.externalId !== "string") {
        throw new TypeError("SPS Host returned an invalid Inbox update result.");
      }
      return { id: result.id, externalId: result.externalId };
    },
    async withdraw(input) {
      await callHost("inbox.withdraw", validateInboxKey(input));
    },
  });

  function validateStateKey(key) {
    if (!isRecord(key) || typeof key.scopeKind !== "string" || typeof key.stateKey !== "string" || key.stateKey.length === 0 ||
      (key.scopeId !== undefined && (typeof key.scopeId !== "string" || key.scopeId.length === 0)) ||
      (key.namespace !== undefined && (typeof key.namespace !== "string" || key.namespace.length === 0))) {
      throw new TypeError("SPS Platform state keys must be valid JSON state keys.");
    }
    return { scopeKind: key.scopeKind, ...(key.scopeId === undefined ? {} : { scopeId: key.scopeId }), ...(key.namespace === undefined ? {} : { namespace: key.namespace }), stateKey: key.stateKey };
  }

  function sendResponse(id, result) {
    write({ jsonrpc: JSON_RPC_VERSION, id, result: result === undefined ? null : result });
  }

  function sendError(id, value) {
    write({ jsonrpc: JSON_RPC_VERSION, id: id ?? null, error: value });
  }

  async function dispatchPlatformMethod(method, params) {
    if (method === "performAction") {
      if (!isRecord(params) || typeof params.key !== "string" || !isRecord(params.params ?? {}) || !isJsonValue(params.params ?? {})
        || !isRecord(params.actorContext) || typeof params.actorContext.companyId !== "string"
        || !["user", "agent", "system"].includes(params.actorContext.type)
        || (params.companyId !== undefined && params.actorContext.companyId !== params.companyId)) throw new TypeError("Invalid authenticated performAction context.");
      const registration = definition.handlers.platform?.actions?.find(action => action.key === params.key);
      if (!registration) throw Object.assign(new Error(`Unknown SPS Platform action: ${params.key}.`), { code: -32601 });
      return withAgentTenant(params.actorContext.companyId, () => registration.handler(params.params ?? {}, { ...platform, companyId: params.actorContext.companyId, actor: Object.freeze({ ...params.actorContext }) }));
    }
    if (method === "getData") {
      if (!isRecord(params) || typeof params.key !== "string" || !isRecord(params.params ?? {}) || !isJsonValue(params.params ?? {}) ||
        (params.companyId !== undefined && typeof params.companyId !== "string") ||
        (params.renderEnvironment !== undefined && !isJsonValue(params.renderEnvironment))) {
        throw new TypeError("Invalid getData params.");
      }
      const registration = definition.handlers.platform?.data.find((provider) => provider.key === params.key);
      if (!registration) throw Object.assign(new Error(`Unknown SPS Platform data provider: ${params.key}`), { code: -32601 });
      return withAgentTenant(params.companyId, () => registration.handler({
        ...(params.params ?? {}),
        ...(params.companyId === undefined ? {} : { companyId: params.companyId }),
        ...(params.renderEnvironment === undefined ? {} : { renderEnvironment: params.renderEnvironment }),
      }, platform));
    }
    if (method === "executeTool") {
      if (!isRecord(params) || typeof params.toolName !== "string" || !isJsonValue(params.parameters) || !isJsonValue(params.runContext)) throw new TypeError("Invalid executeTool params.");
      const registration = definition.handlers.platform?.tools.find((tool) => tool.name === params.toolName);
      if (!registration) throw Object.assign(new Error(`Unknown SPS Platform tool: ${params.toolName}.`), { code: -32601 });
      return withAgentTenant(params.runContext.companyId, () => registration.handler(params.parameters, params.runContext, platform));
    }
    if (method === "onEvent") {
      if (!isRecord(params) || !isRecord(params.event) || typeof params.event.eventType !== "string" || !isJsonValue(params.event)) throw new TypeError("Invalid onEvent params.");
      const registrations = definition.handlers.platform?.events.filter((event) => event.name === params.event.eventType) ?? [];
      if (registrations.length === 0) throw Object.assign(new Error(`Unknown SPS Platform event: ${params.event.eventType}.`), { code: -32601 });
      for (const registration of registrations) {
        await withAgentTenant(params.event.companyId, () => registration.handler(params.event, platform));
      }
      return null;
    }
    if (!isRecord(params) || !isRecord(params.job) || typeof params.job.jobKey !== "string" || !isJsonValue(params.job)) throw new TypeError("Invalid runJob params.");
    const registration = definition.handlers.platform?.jobs.find((job) => job.jobKey === params.job.jobKey);
    if (!registration) throw Object.assign(new Error(`Unknown SPS Platform job: ${params.job.jobKey}.`), { code: -32601 });
    return withAgentTenant(params.job.companyId, () => registration.handler(params.job, platform));
  }

  async function handleHostRequest(message) {
    const { id, method } = message;
    if (!LIFECYCLE_METHODS.has(method) && !PLATFORM_METHODS.has(method)) {
      sendError(id, error(-32601, `Unsupported SPS Worker method: ${String(method)}.`));
      return;
    }
    if (method === "initialize") {
      if (lifecycleState !== "new") {
        sendError(id, error(-32001, "SPS Worker has already been initialized."));
        return;
      }
      lifecycleState = "initializing";
      try {
        // Setup output is plugin-private. The Host always receives the Core
        // InitializeResult shape rather than plugin workflow data.
        await definition.handlers.initialize?.({ params: message.params, spsTransport, platform, inbox, signal: controller.signal });
        for (const registration of definition.handlers.platform?.events ?? []) {
          await callHost("events.subscribe", { eventPattern: registration.name, filter: registration.filter ?? null });
        }
        lifecycleState = "ready";
        const supportedMethods = ["health", "shutdown"].filter((name) => typeof definition.handlers[name] === "function");
        if (definition.handlers.platform) {
          supportedMethods.push("executeTool", "onEvent", "runJob");
          if (definition.handlers.platform.data.length > 0) supportedMethods.push("getData");
          if (definition.handlers.platform.actions?.length > 0) supportedMethods.push("performAction");
        }
        sendResponse(id, { ok: true, supportedMethods });
      } catch (cause) {
        lifecycleState = "new";
        const value = toError(cause, "SPS Worker initialize failed.");
        sendError(id, error(-32000, value.message, value.data));
      }
      return;
    }
    if (PLATFORM_METHODS.has(method)) {
      if (lifecycleState !== "ready") {
        sendError(id, error(-32002, "SPS Worker is not initialized."));
        return;
      }
      const params = message.params;
      try {
        const result = await dispatchPlatformMethod(method, params);
        sendResponse(id, result);
      } catch (cause) {
        const value = toError(cause, `SPS Worker ${method} failed.`);
        sendError(id, error(value.code === -32601 ? -32601 : -32602, value.message, value.data));
      }
      return;
    }
    if (method === "health" && lifecycleState !== "ready") {
      sendError(id, error(-32002, "SPS Worker is not initialized."));
      return;
    }
    if (method === "health" && typeof definition.handlers.health !== "function") {
      sendError(id, error(-32601, "SPS Worker does not implement health."));
      return;
    }
    if (method === "shutdown") lifecycleState = "shutting_down";
    const handler = definition.handlers[method];
    try {
      const result = handler ? await handler({ params: message.params, spsTransport, platform, inbox, signal: controller.signal }) : null;
      sendResponse(id, result);
      if (method === "shutdown") close(new Error("SPS Host requested shutdown."));
    } catch (cause) {
      const value = toError(cause, `SPS Worker ${method} failed.`);
      sendError(id, error(-32000, value.message, value.data));
      if (method === "shutdown") close(value);
    }
  }

  async function handleHostNotification(message) {
    if (message.method === "agents.sessions.event") {
      const event = message.params;
      if (lifecycleState !== "ready" || !isRecord(event) || typeof event.sessionId !== "string" || !isJsonValue(event)) return;
      const callback = sessionCallbacks.get(event.sessionId);
      if (["done", "error"].includes(event.eventType)) sessionCallbacks.delete(event.sessionId);
      try { await callback?.(event); } catch (cause) { logger(`SPS session callback failed: ${toError(cause).message}`); }
      return;
    }
    if (message.method !== "onEvent") {
      logger(`SPS Worker ignored unsupported Host notification: ${String(message.method)}.`);
      return;
    }
    if (lifecycleState !== "ready") {
      logger("SPS Worker ignored an event notification before initialization.");
      return;
    }
    try {
      await dispatchPlatformMethod(message.method, message.params);
    } catch (cause) {
      logger(`SPS Worker event notification failed: ${toError(cause).message}`);
    }
  }

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      sendError(null, error(-32700, "Parse error."));
      return;
    }
    if (!isRecord(message) || message.jsonrpc !== JSON_RPC_VERSION) {
      sendError(null, error(-32600, "Invalid JSON-RPC request."));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "method")) {
      const hasId = Object.prototype.hasOwnProperty.call(message, "id");
      const isNotification = !hasId;
      if (typeof message.method !== "string" || (hasId && typeof message.id !== "string" && typeof message.id !== "number")) {
        if (isNotification) logger("SPS Worker ignored an invalid JSON-RPC notification.");
        else sendError(null, error(-32600, "Invalid JSON-RPC request."));
        return;
      }
      const invocation = message.paperclipInvocation;
      const invoke = () => isNotification ? handleHostNotification(message) : handleHostRequest(message);
      if (invocation !== undefined && (!isRecord(invocation) || typeof invocation.id !== "string" || invocation.id.length === 0 || !isJsonValue(invocation.scope))) {
        if (isNotification) logger("SPS Worker ignored a notification with invalid Host invocation metadata.");
        else sendError(message.id, error(-32600, "Invalid SPS Host invocation."));
        return;
      }
      void (invocation ? invocationStorage.run(invocation, invoke) : invoke()).catch((cause) => logger(`SPS Worker request handling failed: ${toError(cause).message}`));
      return;
    }
    if ((typeof message.id === "string" || typeof message.id === "number") && (Object.prototype.hasOwnProperty.call(message, "result") || Object.prototype.hasOwnProperty.call(message, "error"))) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (Object.prototype.hasOwnProperty.call(message, "error")) request.reject(toError(message.error, "SPS Host RPC failed."));
      else request.resolve(message.result);
      return;
    }
    logger("SPS Worker ignored invalid JSON-RPC response.");
  }

  const reader = createInterface({ input, crlfDelay: Infinity });
  reader.on("line", handleLine);
  reader.on("close", () => close(new Error("SPS Host input stream closed.")));
  input.once?.("error", (cause) => close(toError(cause, "SPS Host input stream failed.")));
  output.once?.("error", (cause) => close(toError(cause, "SPS Worker output stream failed.")));

  return Object.freeze({
    spsTransport,
    signal: controller.signal,
    closed: closedPromise,
    shutdown(reason) { close(toError(reason, "SPS Worker shutdown requested.")); },
  });
}
