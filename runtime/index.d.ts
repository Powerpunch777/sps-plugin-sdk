export const SPS_RUNTIME_CONTRACT_VERSION: "1.0";
export const SPS_RUNTIME_OPERATIONS: readonly [
  "sps.workspaceSources.list", "sps.runtimes.list", "sps.executionGrants.list",
  "sps.executionGrants.upsert", "sps.executionGrants.revoke", "sps.runs.dispatch",
  "sps.runs.get", "sps.runs.listEvents", "sps.artifacts.publish", "sps.artifacts.list"
];

export type SpsRuntimeOperation = (typeof SPS_RUNTIME_OPERATIONS)[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type SpsCorePrimitive =
  | "workspace.sources.metadata"
  | "workspace.sources.route"
  | "runtimes.list"
  | "runtimes.dispatch"
  | "runs.observe"
  | "artifacts.write"
  | "secrets.use";

export interface PluginSpsWorkspaceSource { id: string; displayName: string; status: string; routeStatus: "configured" | "not_configured"; createdAt: string; updatedAt: string; }
export interface PluginSpsRuntime { id: string; nodeId: string; nodeLabel: string; kind: string; runnerKey: string; label: string; profileLabel: string | null; credentialStatus: string; availabilityStatus: string; availabilityDetail: string | null; availabilityObservedAt: string | null; retryAfter: string | null; online: boolean; }
export interface PluginSpsExecutionGrant { id: string; companyId: string; pluginKey: string; subjectKey: string; nodeId: string; runnerProfileId: string; workspaceSourceId: string | null; status: string; revokedAt: string | null; createdAt: string; updatedAt: string; }
export interface PluginSpsRun { id: string; companyId: string; pluginKey: string; subjectKey: string; executionGrantId: string; nodeId: string; runnerProfileId: string; workspaceSourceId: string | null; status: string; exitCode: number | null; signal: string | null; timedOut: boolean; error: string | null; claimedAt: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string; }
export interface PluginSpsRunEvent { sequence: number; stream: string; body: string; createdAt: string; }
export interface PluginSpsArtifact { id: string; companyId: string; pluginKey: string; subjectKey: string; runId: string | null; title: string; kind: string; referenceUrl: string | null; summary: string | null; data: Record<string, unknown>; createdAt: string; updatedAt: string; }

export interface SpsRuntimeTransport {
  request(operation: SpsRuntimeOperation, input: Record<string, unknown>): Promise<unknown>;
}
export interface PluginSpsExecutionGrantInput { companyId: string; subjectKey: string; nodeId: string; runnerProfileId: string; workspaceSourceId?: string | null; }
export interface PluginSpsRunDispatchInput { companyId: string; executionGrantId: string; args: string[]; env?: Record<string, string>; stdin?: string | null; timeoutMs?: number | null; }
export interface PluginSpsArtifactPublishInput { companyId: string; subjectKey: string; runId?: string | null; title: string; kind?: string | null; referenceUrl?: string | null; summary?: string | null; data?: JsonObject; }

export interface PluginSpsClient {
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
    listEvents(companyId: string, runId: string, options?: { afterSequence?: number | null }): Promise<PluginSpsRunEvent[]>;
  };
  readonly artifacts: {
    publish(input: PluginSpsArtifactPublishInput): Promise<PluginSpsArtifact>;
    list(companyId: string, options?: { subjectKey?: string | null; runId?: string | null; limit?: number | null }): Promise<PluginSpsArtifact[]>;
  };
}

export interface SpsRuntimeContract { contractVersion: "2.0"; primitives: readonly SpsCorePrimitive[]; }
export function createSpsRuntimeClient(transport: SpsRuntimeTransport): PluginSpsClient & { readonly contractVersion: "1.0" };
export function defineSpsRuntimeContract(contract?: { contractVersion?: "2.0"; primitives?: readonly SpsCorePrimitive[] }): SpsRuntimeContract;
