export const SPS_RUNTIME_CONTRACT_VERSION: "1.0";
export const SPS_RUNTIME_OPERATIONS: readonly [
  "sps.executions.list", "sps.executions.get", "sps.executions.summarize",
  "sps.workspaceSources.list", "sps.runtimes.list", "sps.executionGrants.list",
  "sps.executionGrants.upsert", "sps.executionGrants.revoke", "sps.runs.dispatch",
  "sps.runs.get", "sps.runs.list", "sps.runs.listEvents", "sps.runs.cancel",
  "sps.artifacts.publish", "sps.artifacts.list"
];

export type SpsRuntimeOperation = (typeof SPS_RUNTIME_OPERATIONS)[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type SpsCorePrimitive =
  | "workspace.sources.metadata"
  | "workspace.sources.route"
  | "runtimes.list"
  | "runtimes.dispatch"
  | "executions.observe"
  | "runs.observe"
  | "runs.cancel"
  | "artifacts.write"
  | "secrets.use";

export interface PluginSpsWorkspaceSource { id: string; displayName: string; status: string; routeStatus: "configured" | "not_configured"; createdAt: string; updatedAt: string; }
/** Read-only cached Node heartbeat/approval metadata; this is not proof of authentication, an active socket, runner readiness, or an execution grant. */
export interface PluginSpsRuntimeConnection {
  executionOwner: "node";
  authorization: "execution_grant_required";
  state: "inactive" | "unverified" | "recently_seen" | "offline" | "unknown";
  observedAt: string | null;
}
export interface PluginSpsRuntime {
  id: string;
  nodeId: string;
  nodeLabel: string;
  kind: string;
  runnerKey: string;
  label: string;
  profileLabel: string | null;
  credentialStatus: string;
  availabilityStatus: string;
  availabilityDetail: string | null;
  availabilityObservedAt: string | null;
  retryAfter: string | null;
  online: boolean;
  /** Older Hosts may omit this cached metadata; absence is unknown. */
  connection?: PluginSpsRuntimeConnection;
}
export interface PluginSpsExecutionGrant { id: string; companyId: string; pluginKey: string; subjectKey: string; nodeId: string; runnerProfileId: string; workspaceSourceId: string | null; status: string; revokedAt: string | null; createdAt: string; updatedAt: string; }
export interface PluginSpsRun { id: string; companyId: string; pluginKey: string; subjectKey: string; executionGrantId: string; nodeId: string; runnerProfileId: string; workspaceSourceId: string | null; status: string; exitCode: number | null; signal: string | null; timedOut: boolean; error: string | null; claimedAt: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string; }
export interface PluginSpsRunEvent { sequence: number; stream: string; body: string; createdAt: string; }
export interface PluginSpsArtifact { id: string; companyId: string; pluginKey: string; subjectKey: string; runId: string | null; title: string; kind: string; referenceUrl: string | null; summary: string | null; data: Record<string, unknown>; createdAt: string; updatedAt: string; }

export type SpsExecutionLane = "node" | "agent_session";
export interface SpsUsageMetric { value: number | null; provenance: "reported" | "estimated" | "unavailable"; }
export interface SpsUsageEvidence {
  inputTokens: SpsUsageMetric;
  cachedInputTokens: SpsUsageMetric;
  outputTokens: SpsUsageMetric;
  costUsd: SpsUsageMetric;
  currency: "USD" | null;
  billingType: "metered_api" | "subscription_included" | "subscription_overage" | "credits" | "fixed" | "unknown";
  costBasis: "incremental_api" | "subscription_reference" | "unknown";
}
export interface SpsExecutionCursor { createdAt: string; runId: string; lane: SpsExecutionLane; }
/** Safe technical metadata; reported usage is adapter-reported, not a bill. */
export interface SpsExecution {
  lane: SpsExecutionLane;
  runId: string;
  companyId: string;
  pluginKey: string;
  agentId: string | null;
  sessionId: string | null;
  subjectKey: string | null;
  runtime: { kind: string | null; model: string | null; modelSource: "reported" | "unavailable" };
  status: string;
  phase: "queued" | "active" | "stopping" | "succeeded" | "failed" | "cancelled" | "interrupted" | "unknown";
  cancellationRequested: boolean;
  termination: "not_applicable" | "pending" | "confirmed";
  failure: { category: "authorization" | "configuration" | "provider_limit" | "timeout" | "cancelled" | "execution" | "unknown"; code: string | null; retrySafety: "requires_review" } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
  usage: SpsUsageEvidence;
}
export interface SpsExecutionPage { items: SpsExecution[]; nextCursor: SpsExecutionCursor | null; }
export interface PluginSpsUsageAggregateMetric {
  reported: number | null;
  estimated: number | null;
  reportedExecutions: number;
  estimatedExecutions: number;
  unavailableExecutions: number;
  overflowed: boolean;
}
export interface PluginSpsExecutionSummaryOptions {
  /** Canonical UTC millisecond timestamps; createdAt window [from, to), at most 31 days. */
  from: string;
  to: string;
  lane?: SpsExecutionLane;
  agentId?: string;
}
export interface PluginSpsExecutionSummary {
  companyId: string;
  pluginKey: string;
  window: { from: string; to: string };
  generatedAt: string;
  executionCount: number;
  terminalCount: number;
  inFlightCount: number;
  unknownPhaseCount: number;
  tokens: { inputTokens: PluginSpsUsageAggregateMetric; cachedInputTokens: PluginSpsUsageAggregateMetric; outputTokens: PluginSpsUsageAggregateMetric };
  /** Costs are adapter reports, not invoices. Never sum these three billing bases together. */
  costs: { currency: "USD"; incrementalApi: PluginSpsUsageAggregateMetric; subscriptionReference: PluginSpsUsageAggregateMetric; other: PluginSpsUsageAggregateMetric };
  duration: { totalMs: number | null; knownExecutions: number; unavailableExecutions: number; overflowed: boolean };
}
export type SpsUsageAggregateMetric = PluginSpsUsageAggregateMetric;
export type SpsExecutionSummaryOptions = PluginSpsExecutionSummaryOptions;
export type SpsExecutionSummary = PluginSpsExecutionSummary;

export interface SpsRuntimeTransport {
  request(operation: SpsRuntimeOperation, input: Record<string, unknown>): Promise<unknown>;
}
export interface PluginSpsExecutionGrantInput { companyId: string; subjectKey: string; nodeId: string; runnerProfileId: string; workspaceSourceId?: string | null; }
export interface PluginSpsRunDispatchInput { companyId: string; executionGrantId: string; args: string[]; env?: Record<string, string>; stdin?: string | null; timeoutMs?: number | null; }
export interface PluginSpsRunListOptions { subjectKey?: string | null; status?: string | null; limit?: number | null; beforeId?: string | null; }
export interface PluginSpsExecutionListOptions { lane?: SpsExecutionLane; limit?: number; before?: SpsExecutionCursor; }
export interface PluginSpsArtifactPublishInput { companyId: string; subjectKey: string; runId?: string | null; title: string; kind?: string | null; referenceUrl?: string | null; summary?: string | null; data?: JsonObject; }

export interface PluginSpsClient {
  readonly executions: {
    list(companyId: string, options?: PluginSpsExecutionListOptions): Promise<SpsExecutionPage>;
    get(companyId: string, lane: SpsExecutionLane, runId: string): Promise<SpsExecution | null>;
    summarize(companyId: string, options: SpsExecutionSummaryOptions): Promise<SpsExecutionSummary>;
  };
  readonly workspaceSources: { list(companyId: string): Promise<PluginSpsWorkspaceSource[]> };
  readonly runtimes: { list(companyId: string, options?: { nodeId?: string | null }): Promise<PluginSpsRuntime[]> };
  readonly executionGrants: {
    list(companyId: string, options?: { subjectKey?: string | null; includeRevoked?: boolean }): Promise<PluginSpsExecutionGrant[]>;
    upsert(input: PluginSpsExecutionGrantInput): Promise<PluginSpsExecutionGrant>;
    revoke(companyId: string, grantId: string): Promise<PluginSpsExecutionGrant>;
  };
  readonly runs: {
    dispatch(input: PluginSpsRunDispatchInput): Promise<PluginSpsRun>;
    get(companyId: string, runId: string): Promise<PluginSpsRun>;
    list(companyId: string, options?: PluginSpsRunListOptions): Promise<PluginSpsRun[]>;
    listEvents(companyId: string, runId: string, options?: { afterSequence?: number | null }): Promise<PluginSpsRunEvent[]>;
    cancel(companyId: string, runId: string): Promise<PluginSpsRun>;
  };
  readonly artifacts: {
    publish(input: PluginSpsArtifactPublishInput): Promise<PluginSpsArtifact>;
    list(companyId: string, options?: { subjectKey?: string | null; runId?: string | null; limit?: number | null }): Promise<PluginSpsArtifact[]>;
  };
}

export interface SpsRuntimeContract { contractVersion: "2.0"; primitives: readonly SpsCorePrimitive[]; }
export function createSpsRuntimeClient(transport: SpsRuntimeTransport): PluginSpsClient & { readonly contractVersion: "1.0" };
export function defineSpsRuntimeContract(contract?: { contractVersion?: "2.0"; primitives?: readonly SpsCorePrimitive[] }): SpsRuntimeContract;
