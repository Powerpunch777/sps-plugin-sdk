/**
 * Provider-neutral Plugin Discovery & Builder authoring contract.
 *
 * These values are transport-safe planning and evidence records. They never
 * contain a local path, secret, command line, raw tool output, or a lifecycle
 * mutation. A host, Desktop, or external authoring provider may implement the
 * operations, but must keep the resulting records within this contract.
 */
export const SPS_PLUGIN_AUTHORING_V1_SCHEMA = "sps-plugin-authoring/v1";
export const SPS_PLUGIN_AUTHORING_NAMESPACES = Object.freeze(["catalog", "project", "build", "preview", "lifecycle"]);
export const SPS_PLUGIN_AUTHORING_OPERATIONS = Object.freeze(["searchCatalog", "createPluginProject", "runAuthoringStep", "inspectBuild", "openPreview", "createLifecycleProposal"]);

const NAMESPACES = new Set(SPS_PLUGIN_AUTHORING_NAMESPACES);
const OPERATIONS = new Set(SPS_PLUGIN_AUTHORING_OPERATIONS);
const REQUEST_KEYS = new Set(["schemaVersion", "authoringSessionId", "operation", "input", "evidenceRefs"]);
const RESULT_KEYS = new Set(["schemaVersion", "authoringSessionId", "operation", "status", "output", "evidenceRefs"]);
const SESSION_KEYS = new Set(["schemaVersion", "authoringSessionId", "evidence"]);
const EVIDENCE_KEYS = new Set(["schemaVersion", "evidenceRef", "operation", "kind", "summary", "occurredAt"]);
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SESSION_ID = /^spsas_[a-z0-9]{8,64}$/;
const EVIDENCE_ID = /^spsae_[a-z0-9]{8,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SECRET_TEXT = /(?:-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|rk|ghp|github_pat|xox[abprs]|AIza)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential|secret|token)\s*[:=])/i;
const EXTERNAL_LOCATION = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|etc|opt|mnt|private|Volumes|root|ProgramData|Windows)(?:[\\/]|$)|~[\\/]|(?:file|ssh|git\+ssh):)/i;

export class SpsPluginAuthoringError extends Error {
  constructor(code, message) { super(message); this.name = "SpsPluginAuthoringError"; this.code = code; }
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw invalid(`${label} must be a plain object.`);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw invalid(`${label} must not contain symbol properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid(`${label} must not contain accessors or hidden properties.`);
    result[key] = descriptor.value;
  }
  return result;
}
function keys(value, label, allowed) { const result = plain(value, label); for (const key of Object.keys(result)) if (!allowed.has(key)) throw invalid(`${label} contains unsupported property "${key}".`); return result; }
function invalid(message) { return new SpsPluginAuthoringError("SPS_PLUGIN_AUTHORING_INVALID", message); }
function unsafe(message) { return new SpsPluginAuthoringError("SPS_PLUGIN_AUTHORING_UNSAFE", message); }
function text(value, label, maximum = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(`${label} must be visible text.`);
  if (SECRET_TEXT.test(value) || EXTERNAL_LOCATION.test(value)) throw unsafe(`${label} must not contain credentials, external locations, or local paths.`);
  return value;
}
function id(value, label) { if (typeof value !== "string" || !ID.test(value)) throw invalid(`${label} is invalid.`); return value; }
function sessionId(value) { if (typeof value !== "string" || !SESSION_ID.test(value)) throw invalid("authoringSessionId is invalid."); return value; }
function evidenceId(value, label = "evidenceRef") { if (typeof value !== "string" || !EVIDENCE_ID.test(value)) throw invalid(`${label} is invalid.`); return value; }
function iso(value, label) { const safe = text(value, label, 24); if (!ISO.test(safe) || new Date(safe).toISOString() !== safe) throw invalid(`${label} must be a UTC ISO-8601 timestamp.`); return safe; }
function array(value, label, maximum, normalize) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw invalid(`${label} must be a plain array.`);
  if (Reflect.ownKeys(value).some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= value.length))) throw invalid(`${label} contains unsupported array properties.`);
  return Object.freeze(value.map((item, index) => normalize(item, `${label}[${index}]`)));
}
function evidenceRefs(value, label = "evidenceRefs") {
  const refs = array(value ?? [], label, 100, (entry, itemLabel) => evidenceId(entry, itemLabel));
  if (new Set(refs).size !== refs.length) throw invalid(`${label} must not contain duplicates.`);
  return Object.freeze([...refs].sort());
}
function exact(value, expected) { return value === expected; }
function operationNamespace(operation) {
  if (operation === "searchCatalog") return "catalog";
  if (operation === "createPluginProject") return "project";
  if (operation === "runAuthoringStep" || operation === "inspectBuild") return "build";
  if (operation === "openPreview") return "preview";
  return "lifecycle";
}
function normalizeRequestInput(operation, input) {
  switch (operation) {
    case "searchCatalog": { const v = keys(input, "searchCatalog.input", new Set(["query", "limit", "sources"])); return Object.freeze({ query: text(v.query, "searchCatalog.input.query", 240), ...(v.limit === undefined ? {} : { limit: integer(v.limit, "searchCatalog.input.limit", 1, 50) }), ...(v.sources === undefined ? {} : { sources: enumArray(v.sources, "searchCatalog.input.sources", ["official", "community", "local"], 3) }) }); }
    case "createPluginProject": { const v = keys(input, "createPluginProject.input", new Set(["templateId", "displayName", "requestedCapabilities"])); return Object.freeze({ templateId: id(v.templateId, "createPluginProject.input.templateId"), displayName: text(v.displayName, "createPluginProject.input.displayName", 120), requestedCapabilities: enumArray(v.requestedCapabilities ?? [], "createPluginProject.input.requestedCapabilities", ["agent.tools.register", "events.subscribe", "events.emit", "jobs.schedule", "ui.page.register", "ui.sidebar.register", "ui.settings.register", "ui.workspaceShell.provide", "ui.dashboard.contribute", "inbox.items.publish", "api.routes.register", "http.outbound", "sps.workspaceSources.read", "sps.runtimes.read", "sps.runs.dispatch", "sps.artifacts.read", "sps.artifacts.write", "secrets.read-ref"], 32) }); }
    case "runAuthoringStep": { const v = keys(input, "runAuthoringStep.input", new Set(["projectId", "step"])); return Object.freeze({ projectId: id(v.projectId, "runAuthoringStep.input.projectId"), step: choice(v.step, "runAuthoringStep.input.step", ["plan", "generate", "refine", "build", "validate", "test"]) }); }
    case "inspectBuild": { const v = keys(input, "inspectBuild.input", new Set(["projectId", "buildId"])); return Object.freeze({ projectId: id(v.projectId, "inspectBuild.input.projectId"), buildId: id(v.buildId, "inspectBuild.input.buildId") }); }
    case "openPreview": { const v = keys(input, "openPreview.input", new Set(["projectId", "buildId", "surface"])); return Object.freeze({ projectId: id(v.projectId, "openPreview.input.projectId"), buildId: id(v.buildId, "openPreview.input.buildId"), surface: choice(v.surface, "openPreview.input.surface", ["shell", "dashboard", "inbox", "settings", "standalone"]) }); }
    case "createLifecycleProposal": { const v = keys(input, "createLifecycleProposal.input", new Set(["projectId", "buildId", "action", "targetPluginId", "reason"])); return Object.freeze({ projectId: id(v.projectId, "createLifecycleProposal.input.projectId"), buildId: id(v.buildId, "createLifecycleProposal.input.buildId"), action: choice(v.action, "createLifecycleProposal.input.action", ["install", "activate", "update", "disable", "remove"]), targetPluginId: id(v.targetPluginId, "createLifecycleProposal.input.targetPluginId"), reason: text(v.reason, "createLifecycleProposal.input.reason", 512) }); }
    default: throw invalid("operation is unsupported.");
  }
}
function normalizeOutput(operation, output) {
  switch (operation) {
    case "searchCatalog": { const v = keys(output, "searchCatalog.output", new Set(["matches"])); return Object.freeze({ matches: array(v.matches, "searchCatalog.output.matches", 50, (item, label) => { const x = keys(item, label, new Set(["pluginId", "version", "title", "summary", "source"])); return Object.freeze({ pluginId: id(x.pluginId, `${label}.pluginId`), version: semver(x.version, `${label}.version`), title: text(x.title, `${label}.title`, 160), summary: text(x.summary, `${label}.summary`, 512), source: choice(x.source, `${label}.source`, ["official", "community", "local"]) }); }) }); }
    case "createPluginProject": { const v = keys(output, "createPluginProject.output", new Set(["projectId", "state"])); return Object.freeze({ projectId: id(v.projectId, "createPluginProject.output.projectId"), state: choice(v.state, "createPluginProject.output.state", ["created", "existing"]) }); }
    case "runAuthoringStep": { const v = keys(output, "runAuthoringStep.output", new Set(["projectId", "buildId", "step", "outcome"])); return Object.freeze({ projectId: id(v.projectId, "runAuthoringStep.output.projectId"), buildId: id(v.buildId, "runAuthoringStep.output.buildId"), step: choice(v.step, "runAuthoringStep.output.step", ["plan", "generate", "refine", "build", "validate", "test"]), outcome: choice(v.outcome, "runAuthoringStep.output.outcome", ["completed", "needs_input", "failed"]) }); }
    case "inspectBuild": { const v = keys(output, "inspectBuild.output", new Set(["projectId", "buildId", "status", "manifestSha256", "workerSha256", "uiSha256"])); return Object.freeze({ projectId: id(v.projectId, "inspectBuild.output.projectId"), buildId: id(v.buildId, "inspectBuild.output.buildId"), status: choice(v.status, "inspectBuild.output.status", ["valid", "invalid", "incomplete"]), ...(v.manifestSha256 === undefined ? {} : { manifestSha256: hash(v.manifestSha256, "inspectBuild.output.manifestSha256") }), ...(v.workerSha256 === undefined ? {} : { workerSha256: hash(v.workerSha256, "inspectBuild.output.workerSha256") }), ...(v.uiSha256 === undefined ? {} : { uiSha256: hash(v.uiSha256, "inspectBuild.output.uiSha256") }) }); }
    case "openPreview": { const v = keys(output, "openPreview.output", new Set(["projectId", "buildId", "previewId", "state"])); return Object.freeze({ projectId: id(v.projectId, "openPreview.output.projectId"), buildId: id(v.buildId, "openPreview.output.buildId"), previewId: id(v.previewId, "openPreview.output.previewId"), state: choice(v.state, "openPreview.output.state", ["ready", "unavailable", "failed"]) }); }
    case "createLifecycleProposal": { const v = keys(output, "createLifecycleProposal.output", new Set(["proposalId", "action", "targetPluginId", "execution", "requiresHostConfirmation"])); const execution = choice(v.execution, "createLifecycleProposal.output.execution", ["proposed"]); return Object.freeze({ proposalId: id(v.proposalId, "createLifecycleProposal.output.proposalId"), action: choice(v.action, "createLifecycleProposal.output.action", ["install", "activate", "update", "disable", "remove"]), targetPluginId: id(v.targetPluginId, "createLifecycleProposal.output.targetPluginId"), execution, requiresHostConfirmation: boolean(v.requiresHostConfirmation, "createLifecycleProposal.output.requiresHostConfirmation") }); }
    default: throw invalid("operation is unsupported.");
  }
}
function integer(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid(`${label} must be an integer between ${min} and ${max}.`); return value; }
function boolean(value, label) { if (typeof value !== "boolean") throw invalid(`${label} must be a boolean.`); return value; }
function choice(value, label, values) { if (typeof value !== "string" || !values.includes(value)) throw invalid(`${label} is invalid.`); return value; }
function enumArray(value, label, values, maximum) { const normalized = array(value, label, maximum, (item, itemLabel) => choice(item, itemLabel, values)); if (new Set(normalized).size !== normalized.length) throw invalid(`${label} must not contain duplicates.`); return Object.freeze([...normalized].sort()); }
function semver(value, label) { if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) throw invalid(`${label} is invalid.`); return value; }
function hash(value, label) { if (typeof value !== "string" || !SHA256.test(value)) throw invalid(`${label} must be a SHA-256 hex digest.`); return value; }

/** Strictly normalizes a provider-neutral authoring request. It has no side effects. */
export function defineSpsPluginAuthoringRequestV1(input) {
  const v = keys(input, "Authoring request", REQUEST_KEYS);
  if (v.schemaVersion !== undefined && !exact(v.schemaVersion, SPS_PLUGIN_AUTHORING_V1_SCHEMA)) throw invalid(`schemaVersion must be ${SPS_PLUGIN_AUTHORING_V1_SCHEMA}.`);
  const operation = choice(v.operation, "operation", SPS_PLUGIN_AUTHORING_OPERATIONS);
  return Object.freeze({ schemaVersion: SPS_PLUGIN_AUTHORING_V1_SCHEMA, namespace: operationNamespace(operation), authoringSessionId: sessionId(v.authoringSessionId), operation, input: normalizeRequestInput(operation, v.input), evidenceRefs: evidenceRefs(v.evidenceRefs) });
}

/** Strictly normalizes an implementation result without accepting raw provider output. */
export function defineSpsPluginAuthoringResultV1(input) {
  const v = keys(input, "Authoring result", RESULT_KEYS);
  if (v.schemaVersion !== undefined && !exact(v.schemaVersion, SPS_PLUGIN_AUTHORING_V1_SCHEMA)) throw invalid(`schemaVersion must be ${SPS_PLUGIN_AUTHORING_V1_SCHEMA}.`);
  const operation = choice(v.operation, "operation", SPS_PLUGIN_AUTHORING_OPERATIONS);
  return Object.freeze({ schemaVersion: SPS_PLUGIN_AUTHORING_V1_SCHEMA, namespace: operationNamespace(operation), authoringSessionId: sessionId(v.authoringSessionId), operation, status: choice(v.status, "status", ["completed", "needs_input", "failed"]), output: normalizeOutput(operation, v.output), evidenceRefs: evidenceRefs(v.evidenceRefs) });
}

/** Creates an empty append-only evidence ledger for one authoring conversation. */
export function createSpsPluginAuthoringSessionV1(authoringSessionId) { return Object.freeze({ schemaVersion: SPS_PLUGIN_AUTHORING_V1_SCHEMA, authoringSessionId: sessionId(authoringSessionId), evidence: Object.freeze([]) }); }

/**
 * Returns a new ledger with one evidence record appended. Existing records are
 * immutable; callers cannot alter or remove prior evidence through this API.
 */
export function appendSpsPluginAuthoringEvidenceV1(session, input) {
  const current = keys(session, "Authoring session", SESSION_KEYS);
  if (current.schemaVersion !== SPS_PLUGIN_AUTHORING_V1_SCHEMA) throw invalid(`Authoring session.schemaVersion must be ${SPS_PLUGIN_AUTHORING_V1_SCHEMA}.`);
  const authoringSessionId = sessionId(current.authoringSessionId);
  const evidence = array(current.evidence, "Authoring session.evidence", 1_000, normalizeEvidence);
  const next = normalizeEvidence(input, "Authoring evidence");
  if (evidence.some((entry) => entry.evidenceRef === next.evidenceRef)) throw invalid("Authoring evidenceRef must be unique within the session.");
  return Object.freeze({ schemaVersion: SPS_PLUGIN_AUTHORING_V1_SCHEMA, authoringSessionId, evidence: Object.freeze([...evidence, next]) });
}
function normalizeEvidence(input, label) {
  const v = keys(input, label, EVIDENCE_KEYS);
  if (v.schemaVersion !== undefined && v.schemaVersion !== SPS_PLUGIN_AUTHORING_V1_SCHEMA) throw invalid(`${label}.schemaVersion is invalid.`);
  return Object.freeze({ schemaVersion: SPS_PLUGIN_AUTHORING_V1_SCHEMA, evidenceRef: evidenceId(v.evidenceRef, `${label}.evidenceRef`), operation: choice(v.operation, `${label}.operation`, SPS_PLUGIN_AUTHORING_OPERATIONS), kind: choice(v.kind, `${label}.kind`, ["request", "result", "review", "diagnostic"]), summary: text(v.summary, `${label}.summary`, 512), occurredAt: iso(v.occurredAt, `${label}.occurredAt`) });
}
