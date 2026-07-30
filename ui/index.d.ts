export const SPS_UI_CONTRACT_VERSION: "1.0";
export const SPS_UI_SUPPORTED_SURFACES: readonly ["page", "sidebar", "settings", "detail-tab"];
export const SPS_UI_FUTURE_CAPABILITIES: readonly ["shell", "dashboard", "inbox"];
export const SPS_UI_DETAIL_ENTITY_TYPES: readonly ["project", "issue", "agent", "goal", "run", "comment", "execution_workspace", "project_workspace"];

export type SpsUiSurface = (typeof SPS_UI_SUPPORTED_SURFACES)[number];
export type SpsUiFutureCapability = (typeof SPS_UI_FUTURE_CAPABILITIES)[number];
export type SpsUiDetailEntityType = (typeof SPS_UI_DETAIL_ENTITY_TYPES)[number];
export type SpsUiCapability = "ui.page.register" | "ui.sidebar.register" | "instance.settings.register" | "ui.detailTab.register";
export type SpsCoreUiSlotType = "page" | "sidebar" | "routeSidebar" | "settingsPage" | "companySettingsPage" | "detailTab";

export interface SpsUiBaseContribution { id: string; label: string; exportName: string; order?: number; }
export interface SpsUiPageContribution extends SpsUiBaseContribution { surface: "page"; routePath: string; }
export interface SpsUiSidebarContribution extends SpsUiBaseContribution { surface: "sidebar"; scope?: "global"; routePath?: never; }
export interface SpsUiRouteSidebarContribution extends SpsUiBaseContribution { surface: "sidebar"; scope: "route"; routePath: string; }
export interface SpsUiInstanceSettingsContribution extends SpsUiBaseContribution { surface: "settings"; scope?: "instance"; routePath?: never; }
export interface SpsUiCompanySettingsContribution extends SpsUiBaseContribution { surface: "settings"; scope: "company"; routePath: string; }
export interface SpsUiDetailTabContribution extends SpsUiBaseContribution { surface: "detail-tab"; entityTypes: readonly SpsUiDetailEntityType[]; }
export type SpsUiContribution = SpsUiPageContribution | SpsUiSidebarContribution | SpsUiRouteSidebarContribution | SpsUiInstanceSettingsContribution | SpsUiCompanySettingsContribution | SpsUiDetailTabContribution;

export interface SpsCoreUiSlot { readonly type: SpsCoreUiSlotType; readonly id: string; readonly displayName: string; readonly exportName: string; readonly routePath?: string; readonly entityTypes?: readonly SpsUiDetailEntityType[]; readonly order?: number; }
export interface SpsUiContributionContract { spsUiContractVersion?: "1.0"; entrypoint: string; contributions: readonly SpsUiContribution[]; }
/** Core manifest fragment: spread this into a manifest alongside its worker entrypoint. */
export interface DefinedSpsUiContributions { readonly entrypoints: { readonly ui: string }; readonly capabilities: readonly SpsUiCapability[]; readonly ui: { readonly slots: readonly SpsCoreUiSlot[] }; }

export function isSpsUiContributionId(value: unknown): value is string;
export function assertSpsUiContributionId(value: unknown, label?: string): string;
export function isSpsUiLabel(value: unknown): value is string;
export function assertSpsUiLabel(value: unknown): string;
export function isSpsUiRoutePath(value: unknown): value is string;
export function assertSpsUiRoutePath(value: unknown, options?: { scope?: "page" | "company" }): string;
export function isSpsUiEntrypoint(value: unknown): value is string;
export function assertSpsUiEntrypoint(value: unknown): string;
export function assertSpsUiExportName(value: unknown): string;
export function validateSpsUiContribution(input: SpsUiContribution): SpsCoreUiSlot;
export function requiredSpsUiCapability(surface: SpsUiSurface, options?: { scope?: "instance" | "company" }): SpsUiCapability;
export function defineSpsUiContributions(input: SpsUiContributionContract): DefinedSpsUiContributions;
