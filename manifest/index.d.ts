export type SpsDashboardWidgetSize = "small" | "medium" | "large" | "full";

export interface SpsWorkspaceShellNavigationItem {
  id: string;
  displayName: string;
  target: string;
  order?: number;
}

export interface SpsWorkspaceShellDashboardPresetItem {
  /** Target plugin key. Omit to target a widget owned by the Shell provider. */
  pluginKey?: string;
  widgetId: string;
  size: SpsDashboardWidgetSize;
  order: number;
}

/** A selectable, plugin-provided Workspace navigation proposal. */
export interface SpsWorkspaceShellDeclaration {
  id: string;
  displayName: string;
  defaultRoute?: string;
  navigation?: readonly SpsWorkspaceShellNavigationItem[];
  dashboardPreset?: readonly SpsWorkspaceShellDashboardPresetItem[];
  emptyWorkspaceAction?: { displayName: string; target: string };
}

/** A workflow-neutral widget rendered inside the SPS Dashboard boundary. */
export interface SpsDashboardWidgetDeclaration {
  id: string;
  displayName: string;
  description?: string;
  exportName: string;
  sizes: readonly SpsDashboardWidgetSize[];
  defaultSize: SpsDashboardWidgetSize;
  defaultOrder: number;
  dataAction: string;
  navigationTarget?: string;
}

export interface SpsInboxActionDeclaration {
  id: string;
  displayName: string;
  action: string;
  destructive?: boolean;
}

export interface SpsPluginEntrypoints {
  worker?: string;
  ui?: string;
  /** Dedicated Worker module used only for Host Workspace integrations. */
  workspaceWorker?: string;
}

export interface SpsWorkspaceSurfaceManifest {
  ui?: {
    workspaceShell?: SpsWorkspaceShellDeclaration;
    dashboardWidgets?: readonly SpsDashboardWidgetDeclaration[];
  };
  inbox?: { actions?: readonly SpsInboxActionDeclaration[] };
}

export interface SpsPluginManifest extends SpsWorkspaceSurfaceManifest {
  id: string;
  apiVersion: 1;
  version: string;
  displayName: string;
  capabilities?: readonly string[];
  entrypoints?: SpsPluginEntrypoints;
  /** Inline JSON Schema applied to Host-owned Workspace configuration; requires entrypoints.workspaceWorker. */
  workspaceConfigSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export function defineSpsWorkspaceSurfaceManifest<T extends SpsWorkspaceSurfaceManifest>(surface: T): Readonly<T>;
export function defineSpsPluginManifest<T extends SpsPluginManifest>(manifest: T): Readonly<T>;
