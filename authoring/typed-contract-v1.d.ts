export const SPS_PLUGIN_AUTHORING_V1_SCHEMA: "sps-plugin-authoring/v1";
export const SPS_PLUGIN_AUTHORING_NAMESPACES: readonly ["catalog", "project", "build", "preview", "lifecycle"];
export const SPS_PLUGIN_AUTHORING_OPERATIONS: readonly ["searchCatalog", "createPluginProject", "runAuthoringStep", "inspectBuild", "openPreview", "createLifecycleProposal"];
export type SpsPluginAuthoringNamespaceV1 = (typeof SPS_PLUGIN_AUTHORING_NAMESPACES)[number];
export type SpsPluginAuthoringOperationV1 = (typeof SPS_PLUGIN_AUTHORING_OPERATIONS)[number];
export type SpsPluginAuthoringStatusV1 = "completed" | "needs_input" | "failed";
export type SpsPluginAuthoringEvidenceRefV1 = `spsae_${string}`;
export type SpsPluginAuthoringSessionIdV1 = `spsas_${string}`;
export type SpsPluginAuthoringErrorCode = "SPS_PLUGIN_AUTHORING_INVALID" | "SPS_PLUGIN_AUTHORING_UNSAFE";
export type SpsPluginLifecycleProposalActionV1 = "install" | "activate" | "update" | "disable" | "remove";
export type SpsPluginLifecycleProposalScopeV1 = "company" | "host";
export interface SpsPluginLifecycleProposalTargetV1 {
  readonly pluginKey: string;
  readonly pluginId?: string | null;
  readonly packageName?: string | null;
  readonly version?: string | null;
  readonly registryStageId?: string | null;
  readonly scope: SpsPluginLifecycleProposalScopeV1;
}
export interface SpsPluginLifecycleProposalInputV1 {
  readonly projectId: string;
  readonly buildId: string;
  readonly action: SpsPluginLifecycleProposalActionV1;
  readonly target: SpsPluginLifecycleProposalTargetV1;
  readonly reason: string;
}
export interface SpsPluginLifecycleProposalOutputV1 {
  readonly proposalId: string;
  readonly action: SpsPluginLifecycleProposalActionV1;
  readonly target: SpsPluginLifecycleProposalTargetV1;
  readonly execution: "proposed";
  readonly requiresHostConfirmation: true;
}
export class SpsPluginAuthoringError extends Error { readonly code: SpsPluginAuthoringErrorCode; }
export interface SpsPluginAuthoringEvidenceV1 { readonly schemaVersion: "sps-plugin-authoring/v1"; readonly evidenceRef: SpsPluginAuthoringEvidenceRefV1; readonly operation: SpsPluginAuthoringOperationV1; readonly kind: "request" | "result" | "review" | "diagnostic"; readonly summary: string; readonly occurredAt: string; }
export interface SpsPluginAuthoringSessionV1 { readonly schemaVersion: "sps-plugin-authoring/v1"; readonly authoringSessionId: SpsPluginAuthoringSessionIdV1; readonly evidence: readonly SpsPluginAuthoringEvidenceV1[]; }
export interface SpsPluginAuthoringRequestV1 { readonly schemaVersion: "sps-plugin-authoring/v1"; readonly namespace: SpsPluginAuthoringNamespaceV1; readonly authoringSessionId: SpsPluginAuthoringSessionIdV1; readonly operation: SpsPluginAuthoringOperationV1; readonly input: Readonly<Record<string, unknown>>; readonly evidenceRefs: readonly SpsPluginAuthoringEvidenceRefV1[]; }
export interface SpsPluginAuthoringResultV1 { readonly schemaVersion: "sps-plugin-authoring/v1"; readonly namespace: SpsPluginAuthoringNamespaceV1; readonly authoringSessionId: SpsPluginAuthoringSessionIdV1; readonly operation: SpsPluginAuthoringOperationV1; readonly status: SpsPluginAuthoringStatusV1; readonly output: Readonly<Record<string, unknown>>; readonly evidenceRefs: readonly SpsPluginAuthoringEvidenceRefV1[]; }
export function defineSpsPluginAuthoringRequestV1(input: unknown): SpsPluginAuthoringRequestV1;
export function defineSpsPluginAuthoringResultV1(input: unknown): SpsPluginAuthoringResultV1;
export function createSpsPluginAuthoringSessionV1(authoringSessionId: SpsPluginAuthoringSessionIdV1): SpsPluginAuthoringSessionV1;
export function appendSpsPluginAuthoringEvidenceV1(session: SpsPluginAuthoringSessionV1, input: Omit<SpsPluginAuthoringEvidenceV1, "schemaVersion"> & { schemaVersion?: "sps-plugin-authoring/v1" }): SpsPluginAuthoringSessionV1;
