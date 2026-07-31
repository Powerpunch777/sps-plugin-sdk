import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSpsPluginDependenciesV1,
  compareSpsPluginVersionsV1,
  defineSpsPluginDependencyManifestV1,
  SpsPluginDependencyError,
} from "./v1.mjs";

const plugin = (id, version, extra = {}) => ({ id, version, ...extra });

test("normalizes an immutable, workflow-neutral dependency declaration", () => {
  const declaration = defineSpsPluginDependencyManifestV1(plugin("com.example.app", "1.0.0", {
    requiredDependencies: [{ id: "com.example.runtime", minVersion: "1.0.0", maxVersion: "1.9.9" }],
    optionalDependencies: [{ service: "assets.render", minVersion: "2.0.0" }, { id: "com.example.telemetry" }],
    conflicts: [{ id: "com.example.legacy", maxVersion: "1.9.9" }],
    services: [{ id: "app.command" }],
  }));
  assert.equal(declaration.schemaVersion, "sps-plugin-dependency/v1");
  assert.equal(Object.isFrozen(declaration), true);
  assert.equal(Object.isFrozen(declaration.requiredDependencies), true);
  assert.equal(Object.isFrozen(declaration.requiredDependencies[0]), true);
  assert.throws(() => declaration.requiredDependencies.push({ id: "com.example.other" }), TypeError);
});

test("accepts plugin identifiers allowed by the Core manifest contract", () => {
  const declaration = defineSpsPluginDependencyManifestV1(plugin("com.example_asset", "1.0.0", {
    requiredDependencies: [{ id: "com.example_runtime" }],
  }));

  assert.equal(declaration.id, "com.example_asset");
  assert.equal(declaration.requiredDependencies[0].id, "com.example_runtime");
});

test("compares SemVer including prerelease precedence and inclusive version bounds", () => {
  assert.equal(compareSpsPluginVersionsV1("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
  assert.equal(compareSpsPluginVersionsV1("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareSpsPluginVersionsV1("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareSpsPluginVersionsV1("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  assert.equal(compareSpsPluginVersionsV1("1.0.0-9007199254740993", "1.0.0-9007199254740992"), 1);
  const report = analyzeSpsPluginDependenciesV1({ plugins: [
    plugin("com.example.app", "1.0.0", { requiredDependencies: [{ id: "com.example.runtime", minVersion: "1.0.0", maxVersion: "1.0.0" }] }),
    plugin("com.example.runtime", "1.0.0"),
  ] });
  assert.equal(report.status, "ready");
});

test("reports missing required dependencies and incompatible versions deterministically", () => {
  const report = analyzeSpsPluginDependenciesV1({ plugins: [
    plugin("com.example.zeta", "1.0.0", { requiredDependencies: [{ id: "com.example.missing" }] }),
    plugin("com.example.alpha", "1.0.0", { requiredDependencies: [{ id: "com.example.runtime", minVersion: "2.0.0" }] }),
    plugin("com.example.runtime", "1.0.0"),
  ] });
  assert.equal(report.status, "blocked");
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.issues), true);
  assert.equal(Object.isFrozen(report.issues[0]), true);
  assert.deepEqual(report.issues, [
    { code: "REQUIRED_VERSION_INCOMPATIBLE", pluginId: "com.example.alpha", dependencyId: "com.example.runtime", actualVersion: "1.0.0", minVersion: "2.0.0" },
    { code: "MISSING_REQUIRED", pluginId: "com.example.zeta", dependencyId: "com.example.missing" },
  ]);
});

test("discovers optional plugin and service providers without blocking availability", () => {
  const report = analyzeSpsPluginDependenciesV1({ plugins: [
    plugin("com.example.app", "1.0.0", { optionalDependencies: [{ id: "com.example.missing" }, { service: "render.sprite", minVersion: "2.0.0" }, { service: "metrics.read" }] }),
    plugin("com.example.renderer", "1.5.0", { services: [{ id: "render.sprite" }] }),
    plugin("com.example.metrics", "2.0.0", { services: [{ id: "metrics.read" }] }),
  ] });
  assert.equal(report.status, "ready");
  assert.deepEqual(report.optionalDependencies, [
    { pluginId: "com.example.app", dependencyId: "com.example.missing", status: "missing", providers: [] },
    { pluginId: "com.example.app", service: "metrics.read", status: "available", providers: ["com.example.metrics"] },
    { pluginId: "com.example.app", service: "render.sprite", status: "incompatible", providers: [] },
  ]);
});

test("reports declared conflicts once per declaration and blocks the plan", () => {
  const report = analyzeSpsPluginDependenciesV1({ plugins: [
    plugin("com.example.app", "1.0.0", { conflicts: [{ id: "com.example.legacy", maxVersion: "2.0.0" }] }),
    plugin("com.example.legacy", "1.4.0"),
  ] });
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.issues, [{ code: "CONFLICT", pluginId: "com.example.app", conflictPluginId: "com.example.legacy", actualVersion: "1.4.0", maxVersion: "2.0.0" }]);
});

test("finds required dependency cycles with canonical deterministic output", () => {
  const report = analyzeSpsPluginDependenciesV1({ plugins: [
    plugin("com.example.charlie", "1.0.0", { requiredDependencies: [{ id: "com.example.alpha" }] }),
    plugin("com.example.bravo", "1.0.0", { requiredDependencies: [{ id: "com.example.charlie" }] }),
    plugin("com.example.alpha", "1.0.0", { requiredDependencies: [{ id: "com.example.bravo" }] }),
  ] });
  assert.deepEqual(report.issues, [{ code: "CYCLE", pluginId: "com.example.alpha", cycle: ["com.example.alpha", "com.example.bravo", "com.example.charlie", "com.example.alpha"] }]);
});

test("previews disable and delete impact without changing caller data or plugin state", () => {
  const plugins = [
    plugin("com.example.app", "1.0.0", { requiredDependencies: [{ id: "com.example.runtime" }] }),
    plugin("com.example.feature", "1.0.0", { requiredDependencies: [{ id: "com.example.app" }] }),
    plugin("com.example.runtime", "1.0.0"),
  ];
  const before = structuredClone(plugins);
  const report = analyzeSpsPluginDependenciesV1({ plugins, target: { action: "disable", pluginId: "com.example.runtime" } });
  assert.deepEqual(plugins, before);
  assert.deepEqual(report.impact, { action: "disable", pluginId: "com.example.runtime", impactedPluginIds: ["com.example.app", "com.example.feature"] });
  assert.deepEqual(report.issues, [{ code: "MISSING_REQUIRED", pluginId: "com.example.app", dependencyId: "com.example.runtime" }]);
  assert.equal(Object.isFrozen(report.impact.impactedPluginIds), true);
  assert.equal(analyzeSpsPluginDependenciesV1({ plugins, target: { action: "delete", pluginId: "com.example.runtime" } }).impact.action, "delete");
});

test("rejects malformed declarations, bounds, duplicate references, accessors, cycles, and prototype abuse without invoking accessors", () => {
  assert.throws(() => defineSpsPluginDependencyManifestV1(plugin("com.example.app", "1.0.0", { requiredDependencies: [{ id: "com.example.runtime", minVersion: "2.0.0", maxVersion: "1.0.0" }] })), SpsPluginDependencyError);
  assert.throws(() => defineSpsPluginDependencyManifestV1(plugin("com.example.app", "1.0.0", { optionalDependencies: [{ id: "com.example.x", service: "x" }] })), SpsPluginDependencyError);
  assert.throws(() => defineSpsPluginDependencyManifestV1(plugin("com.example.app", "1.0.0", { conflicts: [{ id: "com.example.app" }] })), SpsPluginDependencyError);
  assert.throws(() => defineSpsPluginDependencyManifestV1(plugin("com.example.app", "1.0.0", { requiredDependencies: [{ id: "com.example.runtime" }], conflicts: [{ id: "com.example.runtime" }] })), SpsPluginDependencyError);
  assert.throws(() => defineSpsPluginDependencyManifestV1(plugin("com.example.app", "1.0.0", { requiredDependencies: [{ id: "com.example.x" }, { id: "com.example.x" }] })), SpsPluginDependencyError);
  const accessor = { id: "com.example.app", version: "1.0.0" };
  Object.defineProperty(accessor, "requiredDependencies", { enumerable: true, get() { throw new Error("must not run"); } });
  assert.throws(() => defineSpsPluginDependencyManifestV1(accessor), SpsPluginDependencyError);
  const cyclic = plugin("com.example.app", "1.0.0"); cyclic.requiredDependencies = [cyclic];
  assert.throws(() => defineSpsPluginDependencyManifestV1(cyclic), SpsPluginDependencyError);
  const polluted = Object.create({ id: "com.example.app", version: "1.0.0" });
  assert.throws(() => defineSpsPluginDependencyManifestV1(polluted), SpsPluginDependencyError);
  const plugins = [plugin("com.example.app", "1.0.0")];
  Object.defineProperty(plugins, "0", { enumerable: true, get() { throw new Error("must not run"); } });
  assert.throws(() => analyzeSpsPluginDependenciesV1({ plugins }), SpsPluginDependencyError);
  assert.throws(() => analyzeSpsPluginDependenciesV1({ plugins: [plugin("com.example.app", "1.0.0")], target: { action: "remove", pluginId: "com.example.app" } }), SpsPluginDependencyError);
});
