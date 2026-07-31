import { createSpsPluginConformanceReportV1 } from "../conformance/v1.mjs";
import { createSpsPluginDiagnosticSinkV1 } from "../diagnostics/v1.mjs";

export const SPS_PLUGIN_TEST_KIT_V1_SCHEMA = "sps-plugin-test-kit/v1";
export const SPS_PLUGIN_TEST_KIT_CAPABILITIES = Object.freeze([
  "manifest.read", "compatibility.read", "capability.use", "worker.start", "tool.invoke",
  "event.emit", "job.schedule", "run.dispatch", "stream.read", "ui.contribute",
  "connector.use", "mcp.use", "migration.apply", "backup.create", "rollback.apply",
  "visibility.read",
]);

const CAPABILITIES = new Set(SPS_PLUGIN_TEST_KIT_CAPABILITIES);
const UI_STATES = new Set(["live", "empty", "loading", "error", "permission"]);
const SURFACES = new Set(["shell", "dashboard", "inbox"]);
const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,119}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NETWORK_CAPABILITIES = new Set(["connector.use", "mcp.use", "run.dispatch", "stream.read"]);
const STATUS = Object.freeze({
  workspace: ["ready", "offline", "archived"],
  host: ["online", "offline", "stopped"],
  member: ["online", "offline", "removed"],
  node: ["online", "offline", "revoked"],
  runtime: ["ready", "busy", "offline", "removed"],
  source: ["ready", "offline", "removed"],
});
const UNSAFE_TEXT = /(?:\u0000|[\u0001-\u001f\u007f]|(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|etc|opt|mnt|private|Volumes|root|ProgramData|Windows)(?:[\\/]|$)|~[\\/])|-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|rk|ghp|github_pat|xox[abprs]|AIza)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential|secret)\s*[:=])/i;

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object.`);
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} must not contain symbols.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(`${label} must not contain accessors or hidden properties.`);
    output[key] = descriptor.value;
  }
  return output;
}

function assertKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label} contains unsupported property "${key}".`);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} must be a safe identifier.`);
  return value;
}

function assertLabel(value, label) {
  if (typeof value !== "string" || !LABEL.test(value) || UNSAFE_TEXT.test(value)) throw new TypeError(`${label} must be short safe display text.`);
  return value;
}

function assertSemver(value, label) {
  if (typeof value !== "string" || !SEMVER.test(value)) throw new TypeError(`${label} must be a semantic version.`);
  return value;
}

function frozen(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
}

function snapshot(state) {
  return frozen(JSON.parse(JSON.stringify(state)));
}

function stateItem(kind, id, label, status) {
  return { id, label, status, kind };
}

/**
 * Deterministic, pure SDK test environment. It intentionally has no file,
 * process, clock, network, or Desktop dependency. Every transition is modeled
 * as an explicit in-memory state change and a safe diagnostic event.
 */
export function createSpsPluginTestKitV1(options = {}) {
  const input = plain(options, "Test Kit options");
  assertKeys(input, new Set(["pluginId", "pluginVersion", "role", "capabilities", "networkConnected"]), "Test Kit options");
  const pluginId = assertId(input.pluginId ?? "example.plugin", "pluginId");
  const pluginVersion = assertSemver(input.pluginVersion ?? "1.0.0", "pluginVersion");
  const role = input.role ?? "host";
  if (role !== "host" && role !== "member") throw new TypeError("role must be host or member.");
  const requestedCapabilities = input.capabilities ?? SPS_PLUGIN_TEST_KIT_CAPABILITIES;
  if (!Array.isArray(requestedCapabilities) || requestedCapabilities.some((entry) => !CAPABILITIES.has(entry))) throw new TypeError("capabilities must contain known Test Kit capabilities.");
  if (input.networkConnected !== undefined && typeof input.networkConnected !== "boolean") throw new TypeError("networkConnected must be a boolean.");

  let tick = 0;
  const diagnostics = createSpsPluginDiagnosticSinkV1({ maxEvents: 200 });
  const state = {
    schemaVersion: SPS_PLUGIN_TEST_KIT_V1_SCHEMA,
    workspace: { id: "workspace-test", status: "ready" },
    host: { id: "host-test", status: "online" },
    members: [stateItem("member", "member-test", "Test Member", "online")],
    nodes: [stateItem("node", "node-test", "Test Node", "online")],
    runtimes: [stateItem("runtime", "runtime-test", "Test Runtime", "ready")],
    sources: [stateItem("source", "source-test", "Test Source", "ready")],
    role,
    network: { connected: input.networkConnected ?? true, generation: 1 },
    capabilities: { allowed: [...new Set(requestedCapabilities)].sort(), denied: [] },
    plugin: { id: pluginId, version: pluginVersion, enabled: true, deleted: false, previousVersion: null },
    migration: { status: "idle" },
    visibility: { host: "visible", member: "visible" },
    ui: { shell: "live", dashboard: "live", inbox: "live" },
    contributions: [], jobs: [], runs: [], tools: [], events: [], streams: [], connectors: [], mcps: [], backups: [],
    restartGeneration: 0,
  };
  const emit = (origin, category, level, code, message, details = {}) => diagnostics.emit({
    id: `event-${++tick}`,
    origin, category, level, code, message,
    occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick * 1000).toISOString(),
    details,
  });
  const deny = (capability, reason = "Capability denied by test policy") => {
    emit("core", "capability", "warn", "CAPABILITY_DENIED", reason, { capability });
    const error = new Error(reason); error.code = "SPS_PLUGIN_CAPABILITY_DENIED"; throw error;
  };
  const requireCapability = (capability) => {
    if (!state.capabilities.allowed.includes(capability)) deny(capability);
    if (!state.network.connected && NETWORK_CAPABILITIES.has(capability)) {
      emit("desktop", "connector", "warn", "NETWORK_DISCONNECTED", "Network is disconnected in the Test Kit.", { capability });
      const error = new Error("Network is disconnected in the Test Kit."); error.code = "SPS_PLUGIN_NETWORK_DISCONNECTED"; throw error;
    }
  };
  const assertActive = () => {
    if (!state.plugin.enabled || state.plugin.deleted) {
      emit("core", "visibility", "warn", "PLUGIN_INACTIVE", "Plugin is not active in the Test Kit.", { enabled: state.plugin.enabled, deleted: state.plugin.deleted });
      throw new Error("Plugin is not active in the Test Kit.");
    }
  };
  const nextId = (prefix, list) => `${prefix}-${list.length + 1}`;

  function setCapabilities(inputValue = {}) {
    const value = plain(inputValue, "Capability policy"); assertKeys(value, new Set(["allow", "deny"]), "Capability policy");
    for (const field of ["allow", "deny"]) if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].some((entry) => !CAPABILITIES.has(entry)))) throw new TypeError(`${field} must contain known capabilities.`);
    const allowed = new Set(state.capabilities.allowed);
    for (const capability of value.allow ?? []) allowed.add(capability);
    for (const capability of value.deny ?? []) allowed.delete(capability);
    state.capabilities.allowed = [...allowed].sort(); state.capabilities.denied = [...new Set(value.deny ?? [])].sort();
    emit("core", "capability", "info", "CAPABILITY_POLICY_UPDATED", "Capability policy updated.", { allowed: state.capabilities.allowed.length, denied: state.capabilities.denied.length });
    return snapshot(state.capabilities);
  }

  function network(connected) {
    if (typeof connected !== "boolean") throw new TypeError("connected must be a boolean.");
    state.network.connected = connected; state.network.generation += 1;
    emit("desktop", "connector", connected ? "info" : "warn", connected ? "NETWORK_RECONNECTED" : "NETWORK_DISCONNECTED", connected ? "Network reconnected." : "Network disconnected.", { generation: state.network.generation });
    return snapshot(state.network);
  }

  function transition(kind, inputValue) {
    const value = plain(inputValue, `${kind} state`); assertKeys(value, new Set(["id", "status"]), `${kind} state`);
    const status = value.status;
    if (!STATUS[kind].includes(status)) throw new TypeError(`${kind} status is invalid.`);
    let target;
    if (kind === "workspace" || kind === "host") target = state[kind];
    else target = state[`${kind}s`].find((entry) => entry.id === assertId(value.id ?? `${kind}-test`, `${kind} id`));
    if (!target) throw new Error(`${kind} does not exist in the Test Kit.`);
    target.status = status;
    emit("core", kind === "member" ? "visibility" : kind === "node" || kind === "runtime" || kind === "source" ? "connector" : "worker", "info", `${kind.toUpperCase()}_STATE_UPDATED`, `${kind} state updated.`, { status });
    return snapshot(target);
  }

  function lifecycle(operation, inputValue = {}) {
    const value = plain(inputValue, "Lifecycle input"); assertKeys(value, new Set(["version", "migration"]), "Lifecycle input");
    if (!["enable", "disable", "update", "rollback", "delete"].includes(operation)) throw new TypeError("Unknown lifecycle operation.");
    if (operation !== "delete") requireCapability("manifest.read");
    if (operation === "enable") { state.plugin.enabled = true; state.plugin.deleted = false; }
    if (operation === "disable") state.plugin.enabled = false;
    if (operation === "delete") { state.plugin.enabled = false; state.plugin.deleted = true; }
    if (operation === "update") { assertActive(); state.plugin.previousVersion = state.plugin.version; state.plugin.version = assertSemver(value.version, "update version"); if (value.migration !== undefined) migrate(value.migration); }
    if (operation === "rollback") { requireCapability("rollback.apply"); if (!state.plugin.previousVersion) throw new Error("No previous plugin version is available for rollback."); const version = state.plugin.version; state.plugin.version = state.plugin.previousVersion; state.plugin.previousVersion = version; }
    emit("core", operation === "rollback" ? "rollback" : "manifest", "info", `PLUGIN_${operation.toUpperCase()}`, `Plugin ${operation} completed.`, { version: state.plugin.version });
    return snapshot(state.plugin);
  }

  function migrate(inputValue = {}) {
    requireCapability("migration.apply"); const value = plain(inputValue, "Migration input"); assertKeys(value, new Set(["outcome", "id"]), "Migration input");
    const id = assertId(value.id ?? "migration-test", "migration id"); const outcome = value.outcome ?? "pass";
    if (outcome !== "pass" && outcome !== "fail") throw new TypeError("migration outcome must be pass or fail.");
    state.migration = { id, status: outcome === "pass" ? "applied" : "failed" };
    emit("plugin", "migration", outcome === "pass" ? "info" : "error", outcome === "pass" ? "MIGRATION_APPLIED" : "MIGRATION_FAILED", outcome === "pass" ? "Migration applied." : "Migration failed.", { migrationId: id });
    if (outcome === "fail") throw new Error("Migration failed in the Test Kit."); return snapshot(state.migration);
  }

  function contribute(inputValue) {
    requireCapability("ui.contribute"); const value = plain(inputValue, "UI contribution"); assertKeys(value, new Set(["surface", "id"]), "UI contribution");
    if (!SURFACES.has(value.surface)) throw new TypeError("surface must be shell, dashboard, or inbox."); const id = assertId(value.id, "contribution id");
    if (state.contributions.some((entry) => entry.surface === value.surface && entry.id === id)) { emit("core", "ui", "error", "UI_CONTRIBUTION_CONFLICT", "UI contribution conflicts with an existing slot.", { surface: value.surface, contributionId: id }); throw new Error("UI contribution conflicts with an existing slot."); }
    const entry = { surface: value.surface, id }; state.contributions.push(entry); emit("plugin", "ui", "info", "UI_CONTRIBUTION_REGISTERED", "UI contribution registered.", { surface: value.surface, contributionId: id }); return frozen(entry);
  }

  function setUiState(surface, uiState) {
    if (!SURFACES.has(surface) || !UI_STATES.has(uiState)) throw new TypeError("surface or uiState is invalid."); state.ui[surface] = uiState;
    emit("desktop", "ui", uiState === "error" ? "error" : "info", "UI_STATE_UPDATED", "UI state updated.", { surface, state: uiState }); return snapshot(state.ui);
  }

  function record(capability, category, code, list, inputValue = {}) {
    requireCapability(capability); assertActive(); const value = plain(inputValue, `${category} input`); assertKeys(value, new Set(["id", "label"]), `${category} input`);
    const entry = { id: assertId(value.id ?? nextId(category, list), `${category} id`), label: assertLabel(value.label ?? `${category} test`, `${category} label`), status: "completed" };
    list.push(entry); emit("plugin", category, "info", code, `${category} completed.`, { [`${category}Id`]: entry.id }); return frozen(entry);
  }

  function scheduleJob(inputValue = {}) { requireCapability("job.schedule"); assertActive(); const value = plain(inputValue, "Job input"); assertKeys(value, new Set(["id", "recoverable"]), "Job input"); const job = { id: assertId(value.id ?? nextId("job", state.jobs), "job id"), status: "queued", recoverable: value.recoverable !== false }; state.jobs.push(job); emit("plugin", "job", "info", "JOB_QUEUED", "Job queued.", { jobId: job.id }); return frozen(job); }
  function dispatchRun(inputValue = {}) { requireCapability("run.dispatch"); assertActive(); const value = plain(inputValue, "Run input"); assertKeys(value, new Set(["id"]), "Run input"); const run = { id: assertId(value.id ?? nextId("run", state.runs), "run id"), status: "running" }; state.runs.push(run); emit("plugin", "run", "info", "RUN_DISPATCHED", "Run dispatched.", { runId: run.id }); return frozen(run); }
  function createBackup(inputValue = {}) { return record("backup.create", "backup", "BACKUP_CREATED", state.backups, inputValue); }
  function invokeTool(inputValue = {}) { return record("tool.invoke", "tool", "TOOL_INVOKED", state.tools, inputValue); }
  function emitEvent(inputValue = {}) { return record("event.emit", "event", "EVENT_EMITTED", state.events, inputValue); }
  function openStream(inputValue = {}) { return record("stream.read", "stream", "STREAM_OPENED", state.streams, inputValue); }
  function useConnector(inputValue = {}) { return record("connector.use", "connector", "CONNECTOR_USED", state.connectors, inputValue); }
  function useMcp(inputValue = {}) { return record("mcp.use", "mcp", "MCP_USED", state.mcps, inputValue); }
  function setVisibility(inputValue) { requireCapability("visibility.read"); const value = plain(inputValue, "Visibility input"); assertKeys(value, new Set(["audience", "state"]), "Visibility input"); if (!["host", "member"].includes(value.audience) || !["visible", "hidden", "permission"].includes(value.state)) throw new TypeError("visibility audience or state is invalid."); state.visibility[value.audience] = value.state; emit("core", "visibility", "info", "VISIBILITY_UPDATED", "Visibility updated.", { audience: value.audience, state: value.state }); return snapshot(state.visibility); }

  function restart() {
    state.restartGeneration += 1;
    for (const job of state.jobs) if (job.status === "queued" && job.recoverable) job.status = "recovered";
    for (const run of state.runs) if (run.status === "running") run.status = "recovering";
    emit("core", "worker", "warn", "WORKER_RESTARTED", "Worker restart completed with recoverable work preserved.", { generation: state.restartGeneration, jobs: state.jobs.filter((job) => job.status === "recovered").length, runs: state.runs.filter((run) => run.status === "recovering").length });
    return snapshot({ generation: state.restartGeneration, jobs: state.jobs, runs: state.runs });
  }

  return Object.freeze({
    schemaVersion: SPS_PLUGIN_TEST_KIT_V1_SCHEMA,
    get diagnostics() { return diagnostics.read(); },
    snapshot: () => snapshot(state), setCapabilities, allow: (capability) => setCapabilities({ allow: [capability] }), deny: (capability) => setCapabilities({ deny: [capability] }), disconnect: () => network(false), reconnect: () => network(true),
    setWorkspaceState: (value) => transition("workspace", value), setHostState: (value) => transition("host", value), setMemberState: (value) => transition("member", value), setNodeState: (value) => transition("node", value), setRuntimeState: (value) => transition("runtime", value), setSourceState: (value) => transition("source", value),
    enable: (value) => lifecycle("enable", value), disable: (value) => lifecycle("disable", value), update: (value) => lifecycle("update", value), rollback: (value) => lifecycle("rollback", value), delete: (value) => lifecycle("delete", value), migrate, contribute, setUiState, scheduleJob, dispatchRun, createBackup, invokeTool, emitEvent, openStream, useConnector, useMcp, setVisibility, restart, requireCapability,
    createConformanceReport(inputValue = {}) { const value = plain(inputValue, "Conformance input"); assertKeys(value, new Set(["generatedAt", "checks", "metadata"]), "Conformance input"); return createSpsPluginConformanceReportV1({ pluginId: state.plugin.id, pluginVersion: state.plugin.version, generatedAt: value.generatedAt ?? "2026-01-01T00:00:00.000Z", checks: value.checks ?? [{ id: "test-kit", status: "passed", summary: "Deterministic Test Kit completed." }], diagnostics: diagnostics.read(), metadata: value.metadata ?? { testKit: SPS_PLUGIN_TEST_KIT_V1_SCHEMA }, }); },
  });
}
