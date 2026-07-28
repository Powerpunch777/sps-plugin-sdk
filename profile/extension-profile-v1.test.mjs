import assert from "node:assert/strict";
import test from "node:test";
import { inspectSpsExtensionProfile } from "./extension-profile-v1.mjs";

test("accepts an SPS Team Workplane profile", () => {
  const manifest = {
    id: "com.example.team-workplane",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui.js" },
    capabilities: [
      "issues.read",
      "issues.create",
      "issues.update",
      "projects.read",
      "agent.sessions.create",
      "agent.sessions.list",
      "agent.sessions.send",
      "ui.project_tab.register",
      "jobs.schedule",
    ],
    ui: { slots: [{ slot: "project_tab" }] },
    jobs: [{ id: "sync" }],
    agentPlatform: {
      contractVersion: "1.0",
      kind: "workplane",
      profileKey: "sps-lead-worker",
    },
  };
  const result = inspectSpsExtensionProfile(manifest);

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.extension, {
    contractVersion: "1.0",
    kind: "workplane",
    profileKey: "sps-lead-worker",
  });
  assert.deepEqual(result.features, ["surface", "automation"]);
});

test("accepts an SPS-compatible memory store provider", () => {
  const manifest = {
    id: "com.example.memory-provider",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["memory.providers.register", "agent.tools.register", "jobs.schedule"],
    tools: [{ name: "memory_search" }],
    jobs: [{ id: "memory-maintenance" }],
    memoryProvider: { id: "example-memory" },
    agentPlatform: {
      contractVersion: "1.0",
      kind: "store_provider",
    },
  };
  const result = inspectSpsExtensionProfile(manifest);

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.extension?.kind, "store_provider");
  assert.deepEqual(result.features, ["tool", "automation"]);
});

test("accepts a tool provider without implying a workplane or access policy", () => {
  const result = inspectSpsExtensionProfile({
    id: "com.example.discovery",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["agent.tools.register"],
    tools: [{ name: "search-extensions" }],
    agentPlatform: {
      contractVersion: "1.0",
      kind: "tool_provider",
      profileKey: "example-discovery",
    },
  });

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.extension, {
    contractVersion: "1.0",
    kind: "tool_provider",
    profileKey: "example-discovery",
  });
  assert.deepEqual(result.features, ["tool"]);
});

test("rejects a tool provider without a declared tool", () => {
  const result = inspectSpsExtensionProfile({
    id: "com.example.empty-tool-provider",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["agent.tools.register"],
    agentPlatform: { contractVersion: "1.0", kind: "tool_provider" },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Tool provider extensions require at least one tool declaration."));
});

test("reports legacy-compatible manifests without rejecting them", async () => {
  const result = inspectSpsExtensionProfile({
    id: "com.example.legacy",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["agent.tools.register"],
    tools: [{ name: "hello" }],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, ["Legacy-compatible manifest: no agentPlatform extension declaration."]);
});

test("rejects an incomplete workplane declaration", () => {
  const result = inspectSpsExtensionProfile({
    id: "com.example.incomplete-workplane",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: ["issues.read", "projects.read"],
    agentPlatform: {
      contractVersion: "1.0",
      kind: "workplane",
      profileKey: "example",
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Workplane extensions require agent.sessions.send."));
});

test("rejects a tool declaration without the Core tool capability", () => {
  const result = inspectSpsExtensionProfile({
    id: "com.example.missing-tool-capability",
    version: "1.0.0",
    entrypoints: { worker: "./dist/worker.js" },
    capabilities: [],
    tools: [{ name: "hello" }],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Tool declarations require agent.tools.register."));
});
