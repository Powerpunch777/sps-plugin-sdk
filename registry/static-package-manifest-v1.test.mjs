import assert from "node:assert/strict";
import test from "node:test";
import { calculateStaticCapabilitiesDigest, validateStaticPluginManifest } from "./static-package-manifest-v1.mjs";

function makeStaticManifest(overrides = {}) {
  const capabilities = ["ui.page.register", "agent.tools.register"];
  return {
    schemaVersion: 1,
    plugin: { id: "com.example.weather", version: "1.2.3", apiVersion: "1" },
    runtime: { manifestEntry: "dist/manifest.js", manifestSha256: "a".repeat(64) },
    capabilities,
    permissionsDigest: calculateStaticCapabilitiesDigest(capabilities),
    ...overrides,
  };
}

test("validates an immutable declarative package manifest", () => {
  assert.deepEqual(validateStaticPluginManifest(makeStaticManifest()), { valid: true, errors: [] });
});

test("rejects a static manifest whose permission digest or runtime path changes", () => {
  const result = validateStaticPluginManifest(makeStaticManifest({
    runtime: { manifestEntry: "dist/../manifest.js", manifestSha256: "a".repeat(64) },
    permissionsDigest: "b".repeat(64),
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("runtime.manifestEntry")));
  assert.ok(result.errors.some((error) => error.includes("permissionsDigest")));
});
