import assert from "node:assert/strict";
import test from "node:test";
import { inspectSpsExtensionProfileV2, SPS_CORE_PRIMITIVES, SPS_EXECUTIONS_OBSERVE_REQUIRED_CAPABILITY } from "./extension-profile-v2.mjs";

test("accepts a workplane without Paperclip task or session assumptions", () => {
  const result = inspectSpsExtensionProfileV2({
    id: "com.example.custom-workflow",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["agent.tools.register"],
    agentPlatform: { contractVersion: "1.0", kind: "workplane", profileKey: "custom-workflow" },
    sps: {
      contractVersion: "2.0",
      primitives: [
        "workspace.sources.metadata",
        "workspace.sources.route",
        "runtimes.list",
        "runtimes.dispatch",
        "executions.observe",
        "runs.observe",
        "runs.cancel",
      ],
    },
  });

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.features, ["workspace_source", "runtime", "execution_observability", "run_observability"]);
  assert.deepEqual(result.corePrimitives, [
    "workspace.sources.metadata",
    "workspace.sources.route",
    "runtimes.list",
    "runtimes.dispatch",
    "executions.observe",
    "runs.observe",
    "runs.cancel",
  ]);
});

test("accepts the neutral plugin discovery tool provider", () => {
  const result = inspectSpsExtensionProfileV2({
    id: "sps.plugin-discovery",
    version: "0.2.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["agent.tools.register"],
    tools: [{ name: "search-sps-extensions" }],
    agentPlatform: { contractVersion: "1.0", kind: "tool_provider", profileKey: "sps-plugin-discovery" },
    sps: { contractVersion: "2.0", primitives: [] },
  });

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.features, ["tool"]);
});

test("rejects invalid primitive dependencies", () => {
  const result = inspectSpsExtensionProfileV2({
    id: "com.example.invalid",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["agent.tools.register"],
    sps: { contractVersion: "2.0", primitives: ["workspace.sources.route"] },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("workspace.sources.route requires workspace.sources.metadata."));
});

test("exports the public, finite primitive vocabulary", () => {
  assert.deepEqual(SPS_CORE_PRIMITIVES, [
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
  assert.equal(SPS_EXECUTIONS_OBSERVE_REQUIRED_CAPABILITY, "sps.executions.read");
});
