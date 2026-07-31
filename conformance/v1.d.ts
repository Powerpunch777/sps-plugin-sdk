import type { SpsPluginDiagnosticEventV1Input, SpsPluginDiagnosticEventV1 } from "@sonparkserver/plugin-sdk/diagnostics/v1";
export const SPS_PLUGIN_CONFORMANCE_V1_SCHEMA: "sps-plugin-conformance/v1";
export interface SpsPluginConformanceCheckV1 { id: string; status: "passed" | "failed" | "skipped"; summary: string; }
export interface SpsPluginConformanceReportV1Input { pluginId: string; pluginVersion: string; generatedAt: string; checks: readonly SpsPluginConformanceCheckV1[]; diagnostics?: readonly SpsPluginDiagnosticEventV1Input[]; metadata?: Record<string, string>; }
export interface SpsPluginConformanceReportV1 extends Readonly<Omit<SpsPluginConformanceReportV1Input, "diagnostics" | "metadata">> { readonly schemaVersion: "sps-plugin-conformance/v1"; readonly status: "passed" | "failed" | "incomplete"; readonly diagnostics: readonly SpsPluginDiagnosticEventV1[]; readonly metadata: Readonly<Record<string, string>>; }
export function createSpsPluginConformanceReportV1(input: SpsPluginConformanceReportV1Input): SpsPluginConformanceReportV1;
