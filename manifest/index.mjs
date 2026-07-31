const DASHBOARD_SIZES = new Set(["small", "medium", "large", "full"]);
const SURFACE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || (maxLength !== undefined && value.length > maxLength)) {
    throw new TypeError(`${label} must be a non-empty string${maxLength === undefined ? "." : ` with at most ${maxLength} characters.`}`);
  }
  return value;
}

function surfaceId(value, label) {
  const id = nonEmpty(value, label, 100);
  if (!SURFACE_ID_RE.test(id)) throw new TypeError(`${label} must use lowercase letters, numbers, dots, underscores, or hyphens.`);
  return id;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer.`);
  return value;
}

function assertTarget(value, label) {
  const target = nonEmpty(value, label, 500);
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("..")) {
    throw new TypeError(`${label} must be a safe absolute SPS route.`);
  }
  return target;
}

function validateShell(value) {
  if (!isRecord(value)) throw new TypeError("workspaceShell must be an object.");
  surfaceId(value.id, "workspaceShell.id");
  nonEmpty(value.displayName, "workspaceShell.displayName", 100);
  if (value.defaultRoute !== undefined) assertTarget(value.defaultRoute, "workspaceShell.defaultRoute");
  if (value.navigation !== undefined) {
    if (!Array.isArray(value.navigation) || value.navigation.length > 50) throw new TypeError("workspaceShell.navigation must contain at most 50 entries.");
    const ids = new Set();
    for (const item of value.navigation) {
      if (!isRecord(item)) throw new TypeError("workspaceShell.navigation entries must be objects.");
      const id = surfaceId(item.id, "workspaceShell.navigation.id");
      if (ids.has(id)) throw new TypeError("workspaceShell.navigation ids must be unique.");
      ids.add(id);
      nonEmpty(item.displayName, "workspaceShell.navigation.displayName", 100);
      assertTarget(item.target, "workspaceShell.navigation.target");
      if (item.order !== undefined) integer(item.order, "workspaceShell.navigation.order");
    }
  }
  if (value.dashboardPreset !== undefined) {
    if (!Array.isArray(value.dashboardPreset) || value.dashboardPreset.length > 100) throw new TypeError("workspaceShell.dashboardPreset must contain at most 100 entries.");
    for (const item of value.dashboardPreset) {
      if (!isRecord(item)) throw new TypeError("workspaceShell.dashboardPreset entries must be objects.");
      if (item.pluginKey !== undefined) nonEmpty(item.pluginKey, "workspaceShell.dashboardPreset.pluginKey", 150);
      nonEmpty(item.widgetId, "workspaceShell.dashboardPreset.widgetId", 150);
      if (!DASHBOARD_SIZES.has(item.size)) throw new TypeError("workspaceShell.dashboardPreset.size is invalid.");
      integer(item.order, "workspaceShell.dashboardPreset.order");
    }
  }
  if (value.emptyWorkspaceAction !== undefined) {
    if (!isRecord(value.emptyWorkspaceAction)) throw new TypeError("workspaceShell.emptyWorkspaceAction must be an object.");
    nonEmpty(value.emptyWorkspaceAction.displayName, "workspaceShell.emptyWorkspaceAction.displayName", 100);
    assertTarget(value.emptyWorkspaceAction.target, "workspaceShell.emptyWorkspaceAction.target");
  }
}

function validateDashboardWidgets(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("dashboardWidgets must be an array with at most 100 entries.");
  }
  const ids = new Set();
  for (const widget of value) {
    if (!isRecord(widget)) throw new TypeError("dashboardWidgets entries must be objects.");
    const id = surfaceId(widget.id, "dashboardWidget.id");
    if (ids.has(id)) throw new TypeError("dashboardWidget ids must be unique.");
    ids.add(id);
    nonEmpty(widget.displayName, "dashboardWidget.displayName", 100);
    if (widget.description !== undefined && (typeof widget.description !== "string" || widget.description.length > 500)) throw new TypeError("dashboardWidget.description must be a string with at most 500 characters.");
    nonEmpty(widget.exportName, "dashboardWidget.exportName", 150);
    if (!Array.isArray(widget.sizes) || widget.sizes.length === 0 || widget.sizes.some((size) => !DASHBOARD_SIZES.has(size))) {
      throw new TypeError("dashboardWidget.sizes must contain one or more supported sizes.");
    }
    if (new Set(widget.sizes).size !== widget.sizes.length) throw new TypeError("dashboardWidget.sizes must be unique.");
    if (!widget.sizes.includes(widget.defaultSize)) throw new TypeError("dashboardWidget.defaultSize must be declared in sizes.");
    integer(widget.defaultOrder, "dashboardWidget.defaultOrder");
    nonEmpty(widget.dataAction, "dashboardWidget.dataAction", 150);
    if (widget.navigationTarget !== undefined) assertTarget(widget.navigationTarget, "dashboardWidget.navigationTarget");
  }
}

function validateInboxActions(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("inbox.actions must be an array with at most 100 entries.");
  }
  const ids = new Set();
  for (const action of value) {
    if (!isRecord(action)) throw new TypeError("inbox.actions entries must be objects.");
    const id = surfaceId(action.id, "inboxAction.id");
    if (ids.has(id)) throw new TypeError("inboxAction ids must be unique.");
    ids.add(id);
    nonEmpty(action.displayName, "inboxAction.displayName", 100);
    nonEmpty(action.action, "inboxAction.action", 150);
    if (action.destructive !== undefined && typeof action.destructive !== "boolean") throw new TypeError("inboxAction.destructive must be a boolean.");
  }
}

/** Validates the optional, workflow-neutral SPS Workspace surface of a manifest. */
export function defineSpsWorkspaceSurfaceManifest(surface = {}) {
  if (!isRecord(surface)) throw new TypeError("SPS Workspace surface must be an object.");
  if (surface.ui !== undefined) {
    if (!isRecord(surface.ui)) throw new TypeError("ui must be an object.");
    if (surface.ui.workspaceShell !== undefined) validateShell(surface.ui.workspaceShell);
    if (surface.ui.dashboardWidgets !== undefined) validateDashboardWidgets(surface.ui.dashboardWidgets);
  }
  if (surface.inbox !== undefined) {
    if (!isRecord(surface.inbox)) throw new TypeError("inbox must be an object.");
    if (surface.inbox.actions !== undefined) validateInboxActions(surface.inbox.actions);
  }
  return Object.freeze(surface);
}

/** Validates the public manifest identity plus its optional SPS Workspace surface. */
export function defineSpsPluginManifest(manifest) {
  if (!isRecord(manifest)) throw new TypeError("SPS plugin manifest must be an object.");
  nonEmpty(manifest.id, "manifest.id");
  if (manifest.apiVersion !== 1) throw new TypeError("manifest.apiVersion must be 1.");
  nonEmpty(manifest.version, "manifest.version");
  nonEmpty(manifest.displayName, "manifest.displayName");
  defineSpsWorkspaceSurfaceManifest(manifest);
  const capabilities = manifest.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.some((capability) => typeof capability !== "string")) {
    throw new TypeError("manifest.capabilities must be an array of strings.");
  }
  const hasShell = manifest.ui?.workspaceShell !== undefined;
  const hasWidgets = (manifest.ui?.dashboardWidgets?.length ?? 0) > 0;
  const hasInboxActions = (manifest.inbox?.actions?.length ?? 0) > 0;
  if ((hasShell || hasWidgets) && typeof manifest.entrypoints?.ui !== "string") {
    throw new TypeError("manifest.entrypoints.ui is required for Workspace Shell and Dashboard declarations.");
  }
  if (hasShell && !capabilities.includes("ui.workspaceShell.provide")) {
    throw new TypeError("ui.workspaceShell.provide is required when ui.workspaceShell is declared.");
  }
  if (hasWidgets && !capabilities.includes("ui.dashboard.contribute")) {
    throw new TypeError("ui.dashboard.contribute is required when ui.dashboardWidgets are declared.");
  }
  if (hasInboxActions && !capabilities.includes("inbox.actions.register")) {
    throw new TypeError("inbox.actions.register is required when inbox.actions are declared.");
  }
  return Object.freeze({ ...manifest });
}
