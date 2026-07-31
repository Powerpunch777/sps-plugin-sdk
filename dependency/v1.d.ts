export const SPS_PLUGIN_DEPENDENCY_V1_SCHEMA: "sps-plugin-dependency/v1";
export type SpsPluginDependencyIssueCode = "MISSING_REQUIRED" | "REQUIRED_VERSION_INCOMPATIBLE" | "CONFLICT" | "CYCLE";
export class SpsPluginDependencyError extends Error { readonly code: "SPS_PLUGIN_DEPENDENCY_INVALID"; }
export interface SpsPluginVersionBoundsV1 { minVersion?: string; maxVersion?: string; }
export interface SpsPluginRequiredDependencyV1 extends SpsPluginVersionBoundsV1 { id: string; }
export type SpsPluginOptionalDependencyV1 = ({ id: string; service?: never } | { service: string; id?: never }) & SpsPluginVersionBoundsV1;
export interface SpsPluginServiceDeclarationV1 { id: string; }
export interface SpsPluginDependencyManifestV1 { id: string; version: string; requiredDependencies?: readonly SpsPluginRequiredDependencyV1[]; optionalDependencies?: readonly SpsPluginOptionalDependencyV1[]; conflicts?: readonly SpsPluginRequiredDependencyV1[]; services?: readonly SpsPluginServiceDeclarationV1[]; }
export interface SpsPluginDependencyPluginV1 extends SpsPluginDependencyManifestV1 { active?: boolean; }
export interface SpsPluginDependencyTargetV1 { action: "enable" | "disable" | "delete"; pluginId: string; }
export interface SpsPluginDependencyIssueV1 { code: SpsPluginDependencyIssueCode; pluginId: string; dependencyId?: string; conflictPluginId?: string; actualVersion?: string; minVersion?: string; maxVersion?: string; cycle?: readonly string[]; }
export interface SpsPluginOptionalDependencyAnalysisV1 { pluginId: string; dependencyId?: string; service?: string; status: "available" | "incompatible" | "missing"; providers: readonly string[]; }
export interface SpsPluginDependencyAnalysisV1 { readonly schemaVersion: "sps-plugin-dependency/v1"; readonly status: "ready" | "blocked"; readonly plugins: readonly (SpsPluginDependencyManifestV1 & { readonly active: boolean; readonly schemaVersion: "sps-plugin-dependency/v1" })[]; readonly issues: readonly SpsPluginDependencyIssueV1[]; readonly optionalDependencies: readonly SpsPluginOptionalDependencyAnalysisV1[]; readonly target?: SpsPluginDependencyTargetV1; readonly impact?: { readonly action: "enable" | "disable" | "delete"; readonly pluginId: string; readonly impactedPluginIds: readonly string[] }; }
export function compareSpsPluginVersionsV1(left: string, right: string): -1 | 0 | 1;
export function defineSpsPluginDependencyManifestV1<T extends SpsPluginDependencyManifestV1>(input: T): Readonly<SpsPluginDependencyManifestV1>;
export function analyzeSpsPluginDependenciesV1(input: { plugins: readonly SpsPluginDependencyPluginV1[]; target?: SpsPluginDependencyTargetV1 }): SpsPluginDependencyAnalysisV1;
