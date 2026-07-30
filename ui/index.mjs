/**
 * Public, workflow-neutral UI contribution declarations for SPS plugins.
 * This module describes host-mounted UI only; it neither renders markup nor
 * provides navigation controls, so plugins cannot replace host recovery UI.
 */
export const SPS_UI_CONTRACT_VERSION = "1.0";

export const SPS_UI_SUPPORTED_SURFACES = Object.freeze([
  "page",
  "sidebar",
  "settings",
  "detail-tab",
]);

export const SPS_UI_FUTURE_CAPABILITIES = Object.freeze([
  "shell",
  "dashboard",
  "inbox",
]);

export const SPS_UI_DETAIL_ENTITY_TYPES = Object.freeze([
  "project",
  "issue",
  "agent",
  "goal",
  "run",
  "comment",
  "execution_workspace",
  "project_workspace",
]);

const SURFACE_SET = new Set(SPS_UI_SUPPORTED_SURFACES);
const ENTITY_TYPE_SET = new Set(SPS_UI_DETAIL_ENTITY_TYPES);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const ROUTE_PATH_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ENTRYPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ENTRYPOINT_FILE_SUFFIXES = [".js", ".mjs", ".cjs", ".html", ".htm"];
const RESERVED_ROUTE_PATHS = new Set([
  "dashboard", "onboarding", "companies", "company", "settings", "plugins", "org",
  "agents", "projects", "issues", "goals", "approvals", "costs", "activity", "inbox",
  "workspaces", "design-guide", "tests",
]);
const RESERVED_SETTINGS_ROUTE_PATHS = new Set([
  "general", "environments", "access", "members", "invites", "secrets", "instance",
]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => Object.hasOwn(descriptor, "value"),
  );
}

function assertRecord(value, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a plain object without accessor or symbol properties.`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} contains unsupported property "${key}".`);
  }
}

export function isSpsUiLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function assertSpsUiLabel(value) {
  if (!isSpsUiLabel(value)) {
    throw new TypeError("label must be non-empty visible text no longer than 100 characters.");
  }
  return value;
}

export function isSpsUiContributionId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function assertSpsUiContributionId(value, label = "contribution id") {
  if (!isSpsUiContributionId(value)) {
    throw new TypeError(`${label} must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, hyphens, or underscores.`);
  }
  return value;
}

export function isSpsUiRoutePath(value) {
  return typeof value === "string" && ROUTE_PATH_PATTERN.test(value) && !RESERVED_ROUTE_PATHS.has(value);
}

export function assertSpsUiRoutePath(value, options = {}) {
  assertRecord(options, "routePath options");
  assertOnlyKeys(options, ["scope"], "routePath options");
  const scope = options.scope ?? "page";
  if (typeof value !== "string" || !ROUTE_PATH_PATTERN.test(value)) {
    throw new TypeError("routePath must be a lowercase single-segment slug containing letters, digits, or hyphens.");
  }
  if (RESERVED_ROUTE_PATHS.has(value)) throw new TypeError(`routePath "${value}" is reserved by the SPS Host.`);
  if (scope === "company" && RESERVED_SETTINGS_ROUTE_PATHS.has(value)) {
    throw new TypeError(`company settings routePath "${value}" is reserved by the SPS Host.`);
  }
  return value;
}

export function isSpsUiEntrypoint(value) {
  if (typeof value !== "string" || !value.startsWith("./") || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.slice(2).split("/");
  return segments.every((segment) => (
    ENTRYPOINT_SEGMENT_PATTERN.test(segment)
    && segment !== "."
    && segment !== ".."
    && !ENTRYPOINT_FILE_SUFFIXES.some((suffix) => segment.toLowerCase().endsWith(suffix))
  ));
}

export function assertSpsUiEntrypoint(value) {
  if (!isSpsUiEntrypoint(value)) {
    throw new TypeError("entrypoint must be a relative POSIX UI bundle directory such as ./dist/ui-v0.3.2; empty segments, traversal, control characters, backslashes, HTML, and scripts are not accepted.");
  }
  return value;
}

export function assertSpsUiExportName(value) {
  if (typeof value !== "string" || !EXPORT_NAME_PATTERN.test(value)) {
    throw new TypeError("exportName must be a JavaScript identifier naming an export from the UI bundle.");
  }
  return value;
}

function assertOrder(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) throw new TypeError("order must be an integer when provided.");
  return value;
}

function baseSlot(value, allowed) {
  assertOnlyKeys(value, allowed, "UI contribution");
  return {
    id: assertSpsUiContributionId(value.id),
    displayName: assertSpsUiLabel(value.label),
    exportName: assertSpsUiExportName(value.exportName),
    order: assertOrder(value.order),
  };
}

export function validateSpsUiContribution(input) {
  const value = assertRecord(input, "UI contribution");
  const surface = value.surface;
  if (!SURFACE_SET.has(surface)) {
    throw new TypeError(`Unsupported SPS UI surface: ${String(surface)}. Current surfaces are ${SPS_UI_SUPPORTED_SURFACES.join(", ")}; shell, dashboard, and inbox are future capabilities.`);
  }

  if (surface === "page") {
    const slot = baseSlot(value, ["surface", "id", "label", "exportName", "routePath", "order"]);
    return Object.freeze({ type: "page", ...slot, routePath: assertSpsUiRoutePath(value.routePath) });
  }
  if (surface === "sidebar") {
    const slot = baseSlot(value, ["surface", "id", "label", "exportName", "scope", "routePath", "order"]);
    const scope = value.scope ?? "global";
    if (scope !== "global" && scope !== "route") throw new TypeError("sidebar scope must be global or route.");
    if (scope === "global") {
      if (value.routePath !== undefined) throw new TypeError("global sidebar contributions cannot declare routePath.");
      return Object.freeze({ type: "sidebar", ...slot });
    }
    return Object.freeze({ type: "routeSidebar", ...slot, routePath: assertSpsUiRoutePath(value.routePath) });
  }
  if (surface === "settings") {
    const slot = baseSlot(value, ["surface", "id", "label", "exportName", "scope", "routePath", "order"]);
    const scope = value.scope ?? "instance";
    if (scope !== "instance" && scope !== "company") throw new TypeError("settings scope must be instance or company.");
    if (scope === "instance") {
      if (value.routePath !== undefined) throw new TypeError("instance settings contributions cannot declare routePath.");
      return Object.freeze({ type: "settingsPage", ...slot });
    }
    return Object.freeze({ type: "companySettingsPage", ...slot, routePath: assertSpsUiRoutePath(value.routePath, { scope: "company" }) });
  }

  const slot = baseSlot(value, ["surface", "id", "label", "exportName", "entityTypes", "order"]);
  if (!Array.isArray(value.entityTypes) || value.entityTypes.length === 0) {
    throw new TypeError("detail-tab contributions require at least one entityType.");
  }
  if (value.entityTypes.some((entityType) => !ENTITY_TYPE_SET.has(entityType))) {
    throw new TypeError(`detail-tab entityTypes must be supported SPS entity types: ${SPS_UI_DETAIL_ENTITY_TYPES.join(", ")}.`);
  }
  if (new Set(value.entityTypes).size !== value.entityTypes.length) throw new TypeError("detail-tab entityTypes must not contain duplicates.");
  return Object.freeze({ type: "detailTab", ...slot, entityTypes: Object.freeze([...value.entityTypes]) });
}

export function requiredSpsUiCapability(surface, options = {}) {
  assertRecord(options, "capability options");
  assertOnlyKeys(options, ["scope"], "capability options");
  if (!SURFACE_SET.has(surface)) throw new TypeError(`Unsupported SPS UI surface: ${String(surface)}.`);
  if (surface === "page") return "ui.page.register";
  if (surface === "sidebar") return "ui.sidebar.register";
  if (surface === "detail-tab") return "ui.detailTab.register";
  if (options.scope !== undefined && options.scope !== "instance" && options.scope !== "company") {
    throw new TypeError("settings scope must be instance or company.");
  }
  return "instance.settings.register";
}

/**
 * Builds the Core-compatible manifest fragment for the currently supported
 * SPS UI surfaces. The result has no navigation, HTML, or script injection API.
 */
export function defineSpsUiContributions(input) {
  const value = assertRecord(input, "SPS UI contribution contract");
  assertOnlyKeys(value, ["spsUiContractVersion", "entrypoint", "contributions"], "SPS UI contribution contract");
  if (value.spsUiContractVersion !== undefined && value.spsUiContractVersion !== SPS_UI_CONTRACT_VERSION) {
    throw new TypeError(`spsUiContractVersion must be ${SPS_UI_CONTRACT_VERSION}.`);
  }
  const entrypoint = assertSpsUiEntrypoint(value.entrypoint);
  if (!Array.isArray(value.contributions) || value.contributions.length === 0) {
    throw new TypeError("contributions must be a non-empty array.");
  }
  const slots = value.contributions.map(validateSpsUiContribution);
  const ids = slots.map((slot) => slot.id);
  if (new Set(ids).size !== ids.length) throw new TypeError("contribution ids must be unique.");
  const capabilities = [];
  value.contributions.forEach((contribution) => {
    const capability = requiredSpsUiCapability(contribution.surface, { scope: contribution.scope });
    if (!capabilities.includes(capability)) capabilities.push(capability);
  });
  return Object.freeze({
    entrypoints: Object.freeze({ ui: entrypoint }),
    capabilities: Object.freeze(capabilities),
    ui: Object.freeze({ slots: Object.freeze(slots) }),
  });
}
