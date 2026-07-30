/**
 * SPS Extension Profile v1 is a product-level compatibility layer over the
 * Core plugin manifest. It intentionally does not create another runtime or
 * duplicate Core capability checks.
 */
export const SPS_EXTENSION_PROFILE_VERSION = "1.0";

const WORKPLANE_CAPABILITIES = [
  "issues.read",
  "issues.create",
  "issues.update",
  "projects.read",
  "agent.sessions.create",
  "agent.sessions.list",
  "agent.sessions.send",
];

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

function hasCompatibleContractVersion(value) {
  return typeof value === "string" && value.split(".", 1)[0] === SPS_EXTENSION_PROFILE_VERSION.split(".", 1)[0];
}

/**
 * Checks an already-loaded Core plugin manifest against SPS's documented
 * extension profile. This is deliberately structural: host-side authorization
 * remains the Core runtime's responsibility.
 */
export function inspectSpsExtensionProfile(manifest) {
  const errors = [];
  const warnings = [];
  const features = [];

  if (!manifest || typeof manifest !== "object") {
    return {
      valid: false,
      errors: ["Manifest must be an object."],
      warnings,
      features,
      extension: null,
    };
  }

  const capabilities = asArray(manifest.capabilities);
  const slots = asArray(manifest.ui?.slots);
  const tools = asArray(manifest.tools);
  const jobs = asArray(manifest.jobs);
  const apiRoutes = asArray(manifest.apiRoutes);
  const extension = manifest.agentPlatform && typeof manifest.agentPlatform === "object"
    ? manifest.agentPlatform
    : null;

  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push("Manifest must declare a stable string id.");
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push("Manifest must declare a version.");
  }
  if (!manifest.entrypoints || typeof manifest.entrypoints.worker !== "string") {
    errors.push("Manifest must declare a worker entrypoint.");
  }

  if (manifest.companyActivation !== undefined) {
    const activation = manifest.companyActivation;
    if (!activation || typeof activation !== "object" || Array.isArray(activation)) {
      errors.push("companyActivation must be an object when declared.");
    } else if (activation.defaultEnabled !== undefined && typeof activation.defaultEnabled !== "boolean") {
      errors.push("companyActivation.defaultEnabled must be a boolean when declared.");
    }
  }

  if (tools.length > 0) {
    features.push("tool");
    if (!hasCapability(capabilities, "agent.tools.register")) {
      errors.push("Tool declarations require agent.tools.register.");
    }
  }

  if (slots.length > 0) {
    features.push("surface");
    if (!hasUiCapability(capabilities)) {
      errors.push("UI slot declarations require a UI or settings surface registration capability.");
    }
    if (typeof manifest.entrypoints?.ui !== "string") {
      errors.push("UI slot declarations require a UI entrypoint.");
    }
  }

  if (jobs.length > 0) {
    features.push("automation");
    if (!hasCapability(capabilities, "jobs.schedule")) {
      errors.push("Scheduled job declarations require jobs.schedule.");
    }
  }

  if (apiRoutes.length > 0) {
    features.push("integration");
    if (!hasCapability(capabilities, "api.routes.register")) {
      errors.push("API route declarations require api.routes.register.");
    }
  }

  if (hasCapability(capabilities, "events.subscribe") && !features.includes("automation")) {
    features.push("automation");
  }
  if (hasCapability(capabilities, "http.outbound") && !features.includes("integration")) {
    features.push("integration");
  }

  if (!extension) {
    warnings.push("Legacy-compatible manifest: no agentPlatform extension declaration.");
  } else {
    if (!hasCompatibleContractVersion(extension.contractVersion)) {
      errors.push(`Unsupported agentPlatform contractVersion: ${String(extension.contractVersion)}.`);
    }

    if (extension.kind === "workplane") {
      for (const capability of WORKPLANE_CAPABILITIES) {
        if (!hasCapability(capabilities, capability)) {
          errors.push(`Workplane extensions require ${capability}.`);
        }
      }
      if (!extension.profileKey || typeof extension.profileKey !== "string") {
        errors.push("Workplane extensions require a stable profileKey.");
      }
    } else if (extension.kind === "tool_provider") {
      if (tools.length === 0) {
        errors.push("Tool provider extensions require at least one tool declaration.");
      }
      if (!hasCapability(capabilities, "agent.tools.register")) {
        errors.push("Tool provider extensions require agent.tools.register.");
      }
    } else if (extension.kind === "store_provider") {
      if (!hasCapability(capabilities, "memory.providers.register")) {
        errors.push("Store provider extensions require memory.providers.register.");
      }
      if (!manifest.memoryProvider || typeof manifest.memoryProvider !== "object") {
        errors.push("Store provider extensions require a memoryProvider declaration.");
      }
    } else if (extension.kind !== "backend_provider" && extension.kind !== "surface") {
      errors.push(`Unsupported agentPlatform extension kind: ${String(extension.kind)}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    features: [...new Set(features)],
    extension: extension
      ? {
        contractVersion: extension.contractVersion,
        kind: extension.kind,
        profileKey: extension.profileKey ?? null,
      }
      : null,
  };
}
