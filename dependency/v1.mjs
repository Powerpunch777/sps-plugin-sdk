/**
 * Plugin Dependency v1 is a pure, workflow-neutral planning contract.
 * It only analyzes declared state. It never installs, activates, disables,
 * deletes, downloads, or executes a plugin.
 */
export const SPS_PLUGIN_DEPENDENCY_V1_SCHEMA = "sps-plugin-dependency/v1";

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const SERVICE_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const DECLARATION_KEYS = new Set(["id", "version", "requiredDependencies", "optionalDependencies", "conflicts", "services"]);
const ANALYSIS_KEYS = new Set(["plugins", "target"]);
const TARGET_ACTIONS = new Set(["enable", "disable", "delete"]);

export class SpsPluginDependencyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpsPluginDependencyError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function entries(value, label) {
  if (!isPlainObject(value)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must be a plain object.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must not contain symbol properties.`);
  return ownKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must not contain accessors or hidden properties.`);
    return [key, descriptor.value];
  });
}

function object(value, label, allowed) {
  const result = Object.fromEntries(entries(value, label));
  for (const key of Object.keys(result)) if (!allowed.has(key)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} contains unsupported property "${key}".`);
  return result;
}

function safeText(value, label, pattern, maximum = 128) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || !pattern.test(value)) {
    throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} is invalid.`);
  }
  return value;
}

function version(value, label) {
  return safeText(value, label, SEMVER, 128);
}

function semverParts(value) {
  const match = SEMVER.exec(value);
  if (!match) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", "Version is invalid.");
  return { major: match[1], minor: match[2], patch: match[3], prerelease: match[4] ? match[4].split(".") : [] };
}

function compareNumericIdentifier(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Compares two already-valid Semantic Versions without relying on a runtime package. */
export function compareSpsPluginVersionsV1(left, right) {
  const a = semverParts(version(left, "left version"));
  const b = semverParts(version(right, "right version"));
  for (const key of ["major", "minor", "patch"]) {
    const comparison = compareNumericIdentifier(a[key], b[key]);
    if (comparison !== 0) return comparison;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]); const bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) return compareNumericIdentifier(a.prerelease[index], b.prerelease[index]);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.prerelease[index] < b.prerelease[index] ? -1 : 1;
  }
  return 0;
}

function range(value, label) {
  const input = object(value, label, new Set(["id", "minVersion", "maxVersion"]));
  const id = safeText(input.id, `${label}.id`, PLUGIN_ID);
  const minVersion = input.minVersion === undefined ? undefined : version(input.minVersion, `${label}.minVersion`);
  const maxVersion = input.maxVersion === undefined ? undefined : version(input.maxVersion, `${label}.maxVersion`);
  if (minVersion && maxVersion && compareSpsPluginVersionsV1(minVersion, maxVersion) > 0) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} minVersion must not exceed maxVersion.`);
  return Object.freeze({ id, ...(minVersion ? { minVersion } : {}), ...(maxVersion ? { maxVersion } : {}) });
}

function optionalRange(value, label) {
  const input = object(value, label, new Set(["id", "service", "minVersion", "maxVersion"]));
  const hasPlugin = input.id !== undefined; const hasService = input.service !== undefined;
  if (hasPlugin === hasService) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must declare exactly one of id or service.`);
  const minVersion = input.minVersion === undefined ? undefined : version(input.minVersion, `${label}.minVersion`);
  const maxVersion = input.maxVersion === undefined ? undefined : version(input.maxVersion, `${label}.maxVersion`);
  if (minVersion && maxVersion && compareSpsPluginVersionsV1(minVersion, maxVersion) > 0) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} minVersion must not exceed maxVersion.`);
  return Object.freeze({ ...(hasPlugin ? { id: safeText(input.id, `${label}.id`, PLUGIN_ID) } : { service: safeText(input.service, `${label}.service`, SERVICE_ID) }), ...(minVersion ? { minVersion } : {}), ...(maxVersion ? { maxVersion } : {}) });
}

function list(value, label, normalize) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 100) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must be a plain array with at most 100 entries.`);
  if (Reflect.ownKeys(value).some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= value.length))) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} contains unsupported array properties.`);
  const normalized = value.map((item, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} contains an invalid array entry.`);
    return normalize(descriptor.value, `${label}[${index}]`);
  });
  const keys = new Set();
  for (const item of normalized) {
    const key = item.id ? `plugin:${item.id}` : `service:${item.service}`;
    if (keys.has(key)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must not contain duplicate declarations.`);
    keys.add(key);
  }
  return Object.freeze(normalized.sort((a, b) => (a.id ?? a.service).localeCompare(b.id ?? b.service)));
}

function plainArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} must be a plain array with at most ${maximum} entries.`);
  }
  if (Reflect.ownKeys(value).some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= value.length))) {
    throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} contains unsupported array properties.`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `${label} contains an invalid array entry.`);
    result.push(descriptor.value);
  }
  return result;
}

function matchesRange(candidateVersion, declaration) {
  return (!declaration.minVersion || compareSpsPluginVersionsV1(candidateVersion, declaration.minVersion) >= 0)
    && (!declaration.maxVersion || compareSpsPluginVersionsV1(candidateVersion, declaration.maxVersion) <= 0);
}

/** Strictly normalizes one plugin's declarative dependency metadata. */
export function defineSpsPluginDependencyManifestV1(input) {
  const value = object(input, "Plugin dependency manifest", DECLARATION_KEYS);
  const id = safeText(value.id, "Plugin dependency manifest.id", PLUGIN_ID);
  const normalized = {
    schemaVersion: SPS_PLUGIN_DEPENDENCY_V1_SCHEMA,
    id,
    version: version(value.version, "Plugin dependency manifest.version"),
    requiredDependencies: list(value.requiredDependencies ?? [], "requiredDependencies", range),
    optionalDependencies: list(value.optionalDependencies ?? [], "optionalDependencies", optionalRange),
    conflicts: list(value.conflicts ?? [], "conflicts", range),
    services: list(value.services ?? [], "services", (item, label) => {
      const service = object(item, label, new Set(["id"]));
      return Object.freeze({ id: safeText(service.id, `${label}.id`, SERVICE_ID) });
    }),
  };
  for (const declaration of [...normalized.requiredDependencies, ...normalized.conflicts]) {
    if (declaration.id === id) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", "A plugin must not declare itself as a required dependency or conflict.");
  }
  const requiredIds = new Set(normalized.requiredDependencies.map((dependency) => dependency.id));
  const contradictory = normalized.conflicts.find((conflict) => requiredIds.has(conflict.id));
  if (contradictory) {
    throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `A plugin must not both require and conflict with ${contradictory.id}.`);
  }
  return Object.freeze(normalized);
}

function normalizePlugin(input, index) {
  const value = object(input, `plugins[${index}]`, new Set([...DECLARATION_KEYS, "active"]));
  if (value.active !== undefined && typeof value.active !== "boolean") throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `plugins[${index}].active must be a boolean.`);
  const manifest = defineSpsPluginDependencyManifestV1(value);
  return Object.freeze({ ...manifest, active: value.active ?? true });
}

function freezeIssue(code, pluginId, dependency, detail) {
  return Object.freeze({ code, pluginId, ...dependency, ...detail });
}

function sortIssues(items) {
  return Object.freeze(items.sort((a, b) => `${a.pluginId}\u0000${a.code}\u0000${a.dependencyId ?? a.conflictPluginId ?? ""}`.localeCompare(`${b.pluginId}\u0000${b.code}\u0000${b.dependencyId ?? b.conflictPluginId ?? ""}`)));
}

function findCycles(activeById) {
  const results = new Map(); const visited = new Set(); const active = new Set(); const path = [];
  const visit = (id) => {
    if (active.has(id)) {
      const nodes = path.slice(path.indexOf(id));
      const start = nodes.reduce((best, node, index) => node < nodes[best] ? index : best, 0);
      const rotated = [...nodes.slice(start), ...nodes.slice(0, start)];
      const canonical = [...rotated, rotated[0]];
      const signature = canonical.join("\u0000");
      results.set(signature, Object.freeze(canonical));
      return;
    }
    if (visited.has(id)) return;
    visited.add(id); active.add(id); path.push(id);
    for (const dependency of activeById.get(id).requiredDependencies) if (activeById.has(dependency.id)) visit(dependency.id);
    path.pop(); active.delete(id);
  };
  for (const id of [...activeById.keys()].sort()) visit(id);
  return [...results.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([signature, cycle]) => ({ signature, cycle }));
}

function transitiveRequiredDependents(plugins, targetPluginId) {
  const reverse = new Map();
  for (const plugin of plugins) for (const dependency of plugin.requiredDependencies) {
    const dependents = reverse.get(dependency.id) ?? [];
    dependents.push(plugin.id);
    reverse.set(dependency.id, dependents);
  }
  const impacted = new Set(); const pending = [...(reverse.get(targetPluginId) ?? [])].sort();
  while (pending.length) {
    const id = pending.shift();
    if (impacted.has(id)) continue;
    impacted.add(id);
    pending.push(...(reverse.get(id) ?? []).sort());
  }
  return Object.freeze([...impacted].sort());
}

/**
 * Produces deterministic dependency evidence and an optional disable/delete
 * impact preview. This function is side-effect-free and never changes plugin
 * availability.
 */
export function analyzeSpsPluginDependenciesV1(input) {
  const value = object(input, "Plugin dependency analysis", ANALYSIS_KEYS);
  const plugins = plainArray(value.plugins, "plugins", 500).map((item, index) => normalizePlugin(item, index));
  const byId = new Map();
  for (const plugin of plugins) {
    if (byId.has(plugin.id)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", `plugins must not contain duplicate id ${plugin.id}.`);
    byId.set(plugin.id, plugin);
  }
  let target;
  if (value.target !== undefined) {
    const targetValue = object(value.target, "target", new Set(["action", "pluginId"]));
    if (!TARGET_ACTIONS.has(targetValue.action)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", "target.action must be enable, disable, or delete.");
    const pluginId = safeText(targetValue.pluginId, "target.pluginId", PLUGIN_ID);
    if (!byId.has(pluginId)) throw new SpsPluginDependencyError("SPS_PLUGIN_DEPENDENCY_INVALID", "target.pluginId must identify a declared plugin.");
    target = Object.freeze({ action: targetValue.action, pluginId });
  }
  const effective = new Map();
  for (const plugin of plugins) {
    const active = target?.pluginId === plugin.id
      ? target.action === "enable"
      : plugin.active;
    if (active) effective.set(plugin.id, plugin);
  }
  const issues = []; const optional = []; const serviceProviders = new Map();
  for (const plugin of effective.values()) for (const service of plugin.services) {
    const providers = serviceProviders.get(service.id) ?? []; providers.push(plugin); serviceProviders.set(service.id, providers);
  }
  for (const plugin of effective.values()) {
    for (const dependency of plugin.requiredDependencies) {
      const candidate = effective.get(dependency.id);
      if (!candidate) issues.push(freezeIssue("MISSING_REQUIRED", plugin.id, { dependencyId: dependency.id }, {}));
      else if (!matchesRange(candidate.version, dependency)) issues.push(freezeIssue("REQUIRED_VERSION_INCOMPATIBLE", plugin.id, { dependencyId: dependency.id }, { actualVersion: candidate.version, ...(dependency.minVersion ? { minVersion: dependency.minVersion } : {}), ...(dependency.maxVersion ? { maxVersion: dependency.maxVersion } : {}) }));
    }
    for (const declaration of plugin.optionalDependencies) {
      const candidates = declaration.id ? [effective.get(declaration.id)].filter(Boolean) : (serviceProviders.get(declaration.service) ?? []);
      const compatible = candidates.filter((candidate) => matchesRange(candidate.version, declaration)).map((candidate) => candidate.id).sort();
      optional.push(Object.freeze({ pluginId: plugin.id, ...(declaration.id ? { dependencyId: declaration.id } : { service: declaration.service }), status: compatible.length ? "available" : candidates.length ? "incompatible" : "missing", providers: Object.freeze(compatible) }));
    }
    for (const conflict of plugin.conflicts) {
      const candidate = effective.get(conflict.id);
      if (candidate && matchesRange(candidate.version, conflict)) issues.push(freezeIssue("CONFLICT", plugin.id, { conflictPluginId: candidate.id }, { actualVersion: candidate.version, ...(conflict.minVersion ? { minVersion: conflict.minVersion } : {}), ...(conflict.maxVersion ? { maxVersion: conflict.maxVersion } : {}) }));
    }
  }
  for (const cycle of findCycles(effective)) issues.push(Object.freeze({ code: "CYCLE", pluginId: cycle.cycle[0], cycle: cycle.cycle }));
  const impacted = target && (target.action === "disable" || target.action === "delete")
    ? transitiveRequiredDependents(plugins.filter((plugin) => plugin.active), target.pluginId)
    : [];
  return Object.freeze({
    schemaVersion: SPS_PLUGIN_DEPENDENCY_V1_SCHEMA,
    status: issues.length === 0 ? "ready" : "blocked",
    plugins: Object.freeze([...plugins].sort((a, b) => a.id.localeCompare(b.id))),
    issues: sortIssues(issues),
    optionalDependencies: Object.freeze(optional.sort((a, b) => `${a.pluginId}\u0000${a.dependencyId ?? a.service}`.localeCompare(`${b.pluginId}\u0000${b.dependencyId ?? b.service}`))),
    ...(target ? { target, impact: Object.freeze({ action: target.action, pluginId: target.pluginId, impactedPluginIds: Object.freeze(impacted) }) } : {}),
  });
}
