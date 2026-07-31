export const SPS_PLUGIN_DIAGNOSTIC_V1_SCHEMA: "sps-plugin-diagnostic/v1";
export const SPS_PLUGIN_DIAGNOSTIC_ORIGINS: readonly ["core", "desktop", "plugin"];
export const SPS_PLUGIN_DIAGNOSTIC_CATEGORIES: readonly ["manifest", "compatibility", "capability", "worker", "tool", "event", "job", "run", "stream", "ui", "connector", "mcp", "migration", "backup", "rollback", "visibility"];
export const SPS_PLUGIN_DIAGNOSTIC_LEVELS: readonly ["debug", "info", "warn", "error"];
export type SpsPluginDiagnosticOrigin = (typeof SPS_PLUGIN_DIAGNOSTIC_ORIGINS)[number];
export type SpsPluginDiagnosticCategory = (typeof SPS_PLUGIN_DIAGNOSTIC_CATEGORIES)[number];
export type SpsPluginDiagnosticLevel = (typeof SPS_PLUGIN_DIAGNOSTIC_LEVELS)[number];
export type SpsPluginDiagnosticValue = null | boolean | number | string | readonly SpsPluginDiagnosticValue[] | { readonly [key: string]: SpsPluginDiagnosticValue };
export interface SpsPluginDiagnosticEventV1Input { schemaVersion?: "sps-plugin-diagnostic/v1"; id: string; origin: SpsPluginDiagnosticOrigin; category: SpsPluginDiagnosticCategory; level: SpsPluginDiagnosticLevel; code: string; message: string; occurredAt: string; details?: Record<string, SpsPluginDiagnosticValue>; }
export interface SpsPluginDiagnosticEventV1 extends Readonly<Required<SpsPluginDiagnosticEventV1Input>> { readonly schemaVersion: "sps-plugin-diagnostic/v1"; readonly details: Readonly<Record<string, SpsPluginDiagnosticValue>>; }
export type SpsPluginDiagnosticErrorCode = "SPS_PLUGIN_DIAGNOSTIC_INVALID" | "SPS_PLUGIN_DIAGNOSTIC_UNSAFE";
export class SpsPluginDiagnosticError extends Error { readonly code: SpsPluginDiagnosticErrorCode; }
export function normalizeSpsPluginDiagnosticEventV1(input: SpsPluginDiagnosticEventV1Input): SpsPluginDiagnosticEventV1;
export function assertSpsPluginDiagnosticEventV1(input: SpsPluginDiagnosticEventV1Input): SpsPluginDiagnosticEventV1;
export interface SpsPluginDiagnosticSinkV1 { readonly events: readonly SpsPluginDiagnosticEventV1[]; read(): readonly SpsPluginDiagnosticEventV1[]; emit(input: SpsPluginDiagnosticEventV1Input): SpsPluginDiagnosticEventV1; clear(): void; }
export function createSpsPluginDiagnosticSinkV1(options?: { maxEvents?: number }): SpsPluginDiagnosticSinkV1;
