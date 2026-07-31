import assert from "node:assert/strict";
import test from "node:test";
import { createSpsPluginConformanceReportV1 } from "./v1.mjs";

const report = (overrides = {}) => ({ pluginId: "example.plugin", pluginVersion: "1.2.3-beta.1+build.9", generatedAt: "2026-01-01T00:00:00.000Z", checks: [{ id: "unit", status: "passed", summary: "All tests completed." }], metadata: { sdk: "0.5.0" }, ...overrides });

test("conformance creates immutable release evidence with derived status", () => {
  const result = createSpsPluginConformanceReportV1(report({ checks: [{ id: "unit", status: "passed", summary: "Passed." }, { id: "integration", status: "skipped", summary: "Not selected." }] }));
  assert.equal(result.status, "incomplete");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.metadata), true);
});

test("conformance strictly rejects ISO, semver, duplicate check, accessor, cyclic, unsafe, and oversize metadata", () => {
  assert.throws(() => createSpsPluginConformanceReportV1(report({ generatedAt: "2026-01-01T00:00:00Z" })), /ISO/);
  assert.throws(() => createSpsPluginConformanceReportV1(report({ pluginVersion: "1.2" })), /semantic/);
  assert.throws(() => createSpsPluginConformanceReportV1(report({ checks: [{ id: "unit", status: "passed", summary: "ok" }, { id: "unit", status: "passed", summary: "again" }] })), /duplicated/);
  const accessor = {}; Object.defineProperty(accessor, "sdk", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => createSpsPluginConformanceReportV1(report({ metadata: accessor })), /accessors/);
  const cyclic = {}; cyclic.loop = cyclic;
  assert.throws(() => createSpsPluginConformanceReportV1(report({ metadata: cyclic })), /unsafe/);
  assert.throws(() => createSpsPluginConformanceReportV1(report({ metadata: { note: "C:\\Users\\private" } })), /unsafe/);
  assert.throws(() => createSpsPluginConformanceReportV1(report({ metadata: { note: "x".repeat(257) } })), /unsafe/);
  assert.throws(() => createSpsPluginConformanceReportV1(report({ metadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key${index}`, "ok"])) })), /32/);
});
