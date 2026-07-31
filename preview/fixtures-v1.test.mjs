import assert from "node:assert/strict";
import test from "node:test";
import {
  SPS_PLUGIN_PREVIEW_FIXTURE_V1_GLOBAL,
  SpsPluginPreviewFixtureError,
  normalizeSpsPluginPreviewFixtureV1,
  readSpsPluginPreviewFixtureV1,
} from "./fixtures-v1.mjs";

test("normalizes the complete Host Preview fixture contract", () => {
  const fixture = normalizeSpsPluginPreviewFixtureV1({
    role: "member",
    fixtures: {
      node: { enabled: true, payload: { id: "node-preview", label: "Preview node" } },
      runtime: true,
      source: { enabled: false, payload: { label: "hidden source" } },
    },
    viewport: "mobile",
    uiState: "loading",
  });
  assert.deepEqual(fixture, {
    schemaVersion: "sps-plugin-preview-fixture/v1",
    role: "member",
    fixtures: {
      node: { enabled: true, payload: { id: "node-preview", label: "Preview node" } },
      runtime: { enabled: true },
      source: { enabled: false, payload: { label: "hidden source" } },
    },
    viewport: "mobile",
    uiState: "loading",
  });
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.fixtures.node.payload), true);
});

test("uses deterministic safe defaults", () => {
  assert.deepEqual(normalizeSpsPluginPreviewFixtureV1(), {
    schemaVersion: "sps-plugin-preview-fixture/v1",
    role: "host",
    fixtures: { node: { enabled: false }, runtime: { enabled: false }, source: { enabled: false } },
    viewport: "desktop",
    uiState: "live",
  });
});

test("rejects unknown, malformed, accessor, and invalid state fields", () => {
  assert.throws(() => normalizeSpsPluginPreviewFixtureV1({ extra: true }), /unsupported property/);
  assert.throws(() => normalizeSpsPluginPreviewFixtureV1({ role: "operator" }), /host or member/);
  assert.throws(() => normalizeSpsPluginPreviewFixtureV1({ viewport: "tablet" }), /desktop or mobile/);
  assert.throws(() => normalizeSpsPluginPreviewFixtureV1({ uiState: "offline" }), /live, empty, loading, or error/);
  assert.throws(() => normalizeSpsPluginPreviewFixtureV1({ fixtures: { node: { enabled: "yes" } } }), /must be a boolean/);
  const accessor = {};
  Object.defineProperty(accessor, "role", { enumerable: true, get() { throw new Error("must not run"); } });
  assert.throws(() => normalizeSpsPluginPreviewFixtureV1(accessor), /accessors/);
});

test("rejects secrets, credentials, and absolute local paths anywhere in fixture payloads", () => {
  const unsafe = (payload) => assert.throws(
    () => normalizeSpsPluginPreviewFixtureV1({ fixtures: { runtime: { enabled: true, payload } } }),
    (error) => error instanceof SpsPluginPreviewFixtureError && error.code === "SPS_PLUGIN_PREVIEW_FIXTURE_UNSAFE",
  );
  unsafe({ apiKey: "not-allowed" });
  unsafe({ note: "Bearer very-secret-token-value" });
  unsafe({ project: "C:\\Users\\young\\private" });
  unsafe({ cache: "/home/young/private" });
  unsafe({ nested: [{ privateKey: "raw key" }] });
});

test("reads a browser-style injected global without executing getters", () => {
  const scope = {};
  assert.equal(readSpsPluginPreviewFixtureV1(scope), null);
  Object.defineProperty(scope, SPS_PLUGIN_PREVIEW_FIXTURE_V1_GLOBAL, {
    enumerable: false,
    value: { role: "host", fixtures: { source: true }, uiState: "error" },
  });
  assert.deepEqual(readSpsPluginPreviewFixtureV1(scope), normalizeSpsPluginPreviewFixtureV1({
    role: "host", fixtures: { source: true }, uiState: "error",
  }));
  const accessorScope = {};
  Object.defineProperty(accessorScope, SPS_PLUGIN_PREVIEW_FIXTURE_V1_GLOBAL, { get() { throw new Error("must not run"); } });
  assert.throws(() => readSpsPluginPreviewFixtureV1(accessorScope), /data property/);
});

