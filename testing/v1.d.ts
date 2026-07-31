import type { SpsPluginConformanceCheckV1, SpsPluginConformanceReportV1 } from "@sonparkserver/plugin-sdk/conformance/v1";
import type { SpsPluginDiagnosticEventV1 } from "@sonparkserver/plugin-sdk/diagnostics/v1";

export const SPS_PLUGIN_TEST_KIT_V1_SCHEMA: "sps-plugin-test-kit/v1";
export const SPS_PLUGIN_TEST_KIT_CAPABILITIES: readonly ["manifest.read", "compatibility.read", "capability.use", "worker.start", "tool.invoke", "event.emit", "job.schedule", "run.dispatch", "stream.read", "ui.contribute", "connector.use", "mcp.use", "migration.apply", "backup.create", "rollback.apply", "visibility.read"];
export type SpsPluginTestKitCapability = (typeof SPS_PLUGIN_TEST_KIT_CAPABILITIES)[number];
export type SpsPluginTestKitRole = "host" | "member";
export type SpsPluginTestKitUiState = "live" | "empty" | "loading" | "error" | "permission";
export type SpsPluginTestKitVisibility = "visible" | "hidden" | "permission";
export interface SpsPluginTestKitEntry { readonly id: string; readonly status: string; readonly label?: string; }
export interface SpsPluginTestKitV1 {
  readonly schemaVersion: "sps-plugin-test-kit/v1";
  readonly diagnostics: readonly SpsPluginDiagnosticEventV1[];
  snapshot(): Readonly<Record<string, unknown>>;
  setCapabilities(input?: { allow?: readonly SpsPluginTestKitCapability[]; deny?: readonly SpsPluginTestKitCapability[] }): Readonly<Record<string, unknown>>;
  allow(capability: SpsPluginTestKitCapability): Readonly<Record<string, unknown>>;
  deny(capability: SpsPluginTestKitCapability): Readonly<Record<string, unknown>>;
  disconnect(): Readonly<Record<string, unknown>>;
  reconnect(): Readonly<Record<string, unknown>>;
  setWorkspaceState(input: { status: "ready" | "offline" | "archived" }): SpsPluginTestKitEntry;
  setHostState(input: { status: "online" | "offline" | "stopped" }): SpsPluginTestKitEntry;
  setMemberState(input: { id?: string; status: "online" | "offline" | "removed" }): SpsPluginTestKitEntry;
  setNodeState(input: { id?: string; status: "online" | "offline" | "revoked" }): SpsPluginTestKitEntry;
  setRuntimeState(input: { id?: string; status: "ready" | "busy" | "offline" | "removed" }): SpsPluginTestKitEntry;
  setSourceState(input: { id?: string; status: "ready" | "offline" | "removed" }): SpsPluginTestKitEntry;
  enable(input?: object): Readonly<Record<string, unknown>>;
  disable(input?: object): Readonly<Record<string, unknown>>;
  update(input: { version: string; migration?: { outcome?: "pass" | "fail"; id?: string } }): Readonly<Record<string, unknown>>;
  rollback(input?: object): Readonly<Record<string, unknown>>;
  delete(input?: object): Readonly<Record<string, unknown>>;
  migrate(input?: { outcome?: "pass" | "fail"; id?: string }): Readonly<Record<string, unknown>>;
  contribute(input: { surface: "shell" | "dashboard" | "inbox"; id: string }): SpsPluginTestKitEntry;
  setUiState(surface: "shell" | "dashboard" | "inbox", state: SpsPluginTestKitUiState): Readonly<Record<string, unknown>>;
  scheduleJob(input?: { id?: string; recoverable?: boolean }): SpsPluginTestKitEntry;
  dispatchRun(input?: { id?: string }): SpsPluginTestKitEntry;
  createBackup(input?: { id?: string; label?: string }): SpsPluginTestKitEntry;
  invokeTool(input?: { id?: string; label?: string }): SpsPluginTestKitEntry;
  emitEvent(input?: { id?: string; label?: string }): SpsPluginTestKitEntry;
  openStream(input?: { id?: string; label?: string }): SpsPluginTestKitEntry;
  useConnector(input?: { id?: string; label?: string }): SpsPluginTestKitEntry;
  useMcp(input?: { id?: string; label?: string }): SpsPluginTestKitEntry;
  setVisibility(input: { audience: "host" | "member"; state: SpsPluginTestKitVisibility }): Readonly<Record<string, unknown>>;
  restart(): Readonly<Record<string, unknown>>;
  requireCapability(capability: SpsPluginTestKitCapability): void;
  createConformanceReport(input?: { generatedAt?: string; checks?: readonly SpsPluginConformanceCheckV1[]; metadata?: Record<string, string> }): SpsPluginConformanceReportV1;
}
export function createSpsPluginTestKitV1(options?: { pluginId?: string; pluginVersion?: string; role?: SpsPluginTestKitRole; capabilities?: readonly SpsPluginTestKitCapability[]; networkConnected?: boolean }): SpsPluginTestKitV1;
