export const SPS_PLUGIN_PREVIEW_FIXTURE_V1_SCHEMA: "sps-plugin-preview-fixture/v1";
export const SPS_PLUGIN_PREVIEW_FIXTURE_V1_GLOBAL: "__SPS_PLUGIN_PREVIEW_FIXTURE_V1__";

export type SpsPluginPreviewRole = "host" | "member";
export type SpsPluginPreviewViewport = "desktop" | "mobile";
export type SpsPluginPreviewUiState = "live" | "empty" | "loading" | "error";
export type SpsPluginPreviewJsonValue = null | boolean | number | string | SpsPluginPreviewJsonValue[] | { [key: string]: SpsPluginPreviewJsonValue };
export type SpsPluginPreviewJsonObject = { [key: string]: SpsPluginPreviewJsonValue };

export interface SpsPluginPreviewFixtureToggleInput {
  enabled: boolean;
  payload?: SpsPluginPreviewJsonObject;
}

export interface SpsPluginPreviewFixtureToggle {
  readonly enabled: boolean;
  readonly payload?: Readonly<SpsPluginPreviewJsonObject>;
}

export interface SpsPluginPreviewFixturesInput {
  node?: boolean | SpsPluginPreviewFixtureToggleInput;
  runtime?: boolean | SpsPluginPreviewFixtureToggleInput;
  source?: boolean | SpsPluginPreviewFixtureToggleInput;
}

export interface SpsPluginPreviewFixtureV1Input {
  schemaVersion?: "sps-plugin-preview-fixture/v1";
  role?: SpsPluginPreviewRole;
  fixtures?: SpsPluginPreviewFixturesInput;
  viewport?: SpsPluginPreviewViewport;
  uiState?: SpsPluginPreviewUiState;
}

export interface SpsPluginPreviewFixtureV1 {
  readonly schemaVersion: "sps-plugin-preview-fixture/v1";
  readonly role: SpsPluginPreviewRole;
  readonly fixtures: Readonly<{
    node: SpsPluginPreviewFixtureToggle;
    runtime: SpsPluginPreviewFixtureToggle;
    source: SpsPluginPreviewFixtureToggle;
  }>;
  readonly viewport: SpsPluginPreviewViewport;
  readonly uiState: SpsPluginPreviewUiState;
}

export type SpsPluginPreviewFixtureErrorCode = "SPS_PLUGIN_PREVIEW_FIXTURE_INVALID" | "SPS_PLUGIN_PREVIEW_FIXTURE_UNSAFE";
export class SpsPluginPreviewFixtureError extends Error {
  readonly code: SpsPluginPreviewFixtureErrorCode;
}

export function normalizeSpsPluginPreviewFixtureV1(input?: SpsPluginPreviewFixtureV1Input): SpsPluginPreviewFixtureV1;
export function assertSpsPluginPreviewFixtureV1(input: SpsPluginPreviewFixtureV1Input): SpsPluginPreviewFixtureV1;
export function readSpsPluginPreviewFixtureV1(scope?: object): SpsPluginPreviewFixtureV1 | null;

