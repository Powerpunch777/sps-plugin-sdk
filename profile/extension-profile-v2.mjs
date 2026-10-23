/**
 * SPS Extension Profile v2 standardizes the workflow-neutral boundary between
 * a plugin and SPS Core. It deliberately does not define a task model, role
 * hierarchy, memory strategy, or approval workflow.
 */
export const SPS_EXTENSION_PROFILE_V2_VERSION = "2.0";

export const SPS_CORE_PRIMITIVES = Object.freeze([
  "workspace.sources.metadata",
  "workspace.sources.route",
  "runtimes.list",
  "runtimes.dispatch",
  "executions.observe",
  "runs.observe",
  "runs.cancel",
  "artifacts.write",
  "secrets.use",
]);

export const SPS_EXECUTIONS_OBSERVE_REQUIRED_CAPABILITY = "sps.executions.read";

const CORE_PRIMITIVE_SET = new Set(SPS_CORE_PRIMITIVES);
const EXTENSION_KINDS = new Set([
  "tool_provider",
  "surface",
  "workplane",
  "store_provider",
  "backend_provider",
]);
const UI_CAPABILITY_PREFIX = "ui.";
const SETTINGS_SURFACE_CAPABILITY = "instance.settings.register";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasCapability(capabilities, capability) {
  return capabilities.includes(capability);
}

function hasUiCapability(capabilities) {
  return capabilities.some((capability) =>
    capability.startsWith(UI_CAPABILITY_PREFIX) || capability === SETTINGS_SURFACE_CAPABILITY,
  );
}

function isCompatibleSpsContract(value) {
  return typeof value === "string" && value.split(".", 1)[0] === "2";
}

/**
 * Inspects a Core plugin manifest against the public SPS Extension Profile v2.
 * The result is structural only. A declaration never grants a plugin access to
 * a Host path, runtime credential, secret, or execution target.
 */
export function inspectSpsExtensionProfileV2(manifest) {
  const errors = [];
  const warnings = [];
  const features = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["Manifest must be an object."], warnings, features, extension: null, corePrimitives: [] };
  }

  const capabilities = asArray(manifest.capabilities);
  const slots = asArray(manifest.ui?.slots);
  const tools = asArray(manifest.tools);
  const jobs = asArray(manifest.jobs);
  const apiRoutes = asArray(manifest.apiRoutes);
  const extension = manifest.agentPlatform && typeof manifest.agentPlatform === "object"
    ? manifest.agentPlatform
    : null;
  const sps = manifest.sps && typeof manifest.sps === "object" && !Array.isArray(manifest.sps)
    ? manifest.sps
    : null;

  if (!manifest.id || typeof manifest.id !== "string") errors.push("Manifest must declare a stable string id.");
  if (!manifest.version || typeof manifest.version !== "string") errors.push("Manifest must declare a version.");
  if (!manifest.entrypoints || typeof manifest.entrypoints.worker !== "string") {
    errors.push("Manifest must declare a worker entrypoint.");
  }

  if (tools.length > 0) {
    features.push("tool");
    if (!hasCapability(capabilities, "agent.tools.register")) {
      errors.push("Tool declarations require agent.tools.register.");
    }
  }
  if (slots.length > 0) {
    features.push("surface");
    if (!hasUiCapability(capabilities)) errors.push("UI slot declarations require a UI or settings surface registration capability.");
    if (typeof manifest.entrypoints?.ui !== "string") errors.push("UI slot declarations require a UI entrypoint.");
  }
  if (jobs.length > 0) {
    features.push("automation");
    if (!hasCapability(capabilities, "jobs.schedule")) errors.push("Scheduled job declarations require jobs.schedule.");
  }
  if (apiRoutes.length > 0) {
    features.push("integration");
    if (!hasCapability(capabilities, "api.routes.register")) errors.push("API route declarations require api.routes.register.");
  }
  if (hasCapability(capabilities, "events.subscribe") && !features.includes("automation")) features.push("automation");
  if (hasCapability(capabilities, "http.outbound") && !features.includes("integration")) features.push("integration");

  if (!extension) {
    warnings.push("No agentPlatform declaration: the plugin remains compatible but is not categorized by SPS.");
  } else {
    if (!EXTENSION_KINDS.has(extension.kind)) {
      errors.push(`Unsupported SPS extension kind: ${String(extension.kind)}.`);
    }
    if (extension.kind === "workplane" && (!extension.profileKey || typeof extension.profileKey !== "string")) {
      errors.push("Workplane extensions require a stable profileKey.");
    }
    if (extension.kind === "store_provider") {
      if (!hasCapability(capabilities, "memory.providers.register")) {
        errors.push("Store provider extensions require memory.providers.register.");
      }
      if (!manifest.memoryProvider || typeof manifest.memoryProvider !== "object") {
        errors.push("Store provider extensions require a memoryProvider declaration.");
      }
    }
  }

  let corePrimitives = [];
  if (!sps) {
    warnings.push("No SPS Core declaration: this manifest is compatible with the v1 bridge only.");
  } else {
    if (!isCompatibleSpsContract(sps.contractVersion)) {
      errors.push(`Unsupported SPS Core contractVersion: ${String(sps.contractVersion)}.`);
    }
    if (!Array.isArray(sps.primitives)) {
      errors.push("SPS Core declarations require a primitives array.");
    } else {
      corePrimitives = sps.primitives.filter((primitive) => typeof primitive === "string");
      const invalid = corePrimitives.filter((primitive) => !CORE_PRIMITIVE_SET.has(primitive));
      if (invalid.length > 0) errors.push(`Unsupported SPS Core primitives: ${[...new Set(invalid)].join(", ")}.`);
      const duplicates = corePrimitives.filter((primitive, index) => corePrimitives.indexOf(primitive) !== index);
      if (duplicates.length > 0) errors.push(`Duplicate SPS Core primitives: ${[...new Set(duplicates)].join(", ")}.`);
      if (corePrimitives.includes("workspace.sources.route") && !corePrimitives.includes("workspace.sources.metadata")) {
        errors.push("workspace.sources.route requires workspace.sources.metadata.");
      }
      if (corePrimitives.includes("runtimes.dispatch") && !corePrimitives.includes("runtimes.list")) {
        errors.push("runtimes.dispatch requires runtimes.list.");
      }
      if (corePrimitives.some((primitive) => primitive.startsWith("workspace.sources."))) features.push("workspace_source");
      if (corePrimitives.some((primitive) => primitive.startsWith("runtimes."))) features.push("runtime");
      if (corePrimitives.includes("executions.observe")) features.push("execution_observability");
      if (corePrimitives.includes("runs.observe")) features.push("run_observability");
      if (corePrimitives.includes("artifacts.write")) features.push("artifact");
      if (corePrimitives.includes("secrets.use")) features.push("secret_reference");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    features: [...new Set(features)],
    extension: extension
      ? {
        kind: typeof extension.kind === "string" ? extension.kind : null,
        profileKey: typeof extension.profileKey === "string" ? extension.profileKey : null,
      }
      : null,
    corePrimitives,
  };
}
