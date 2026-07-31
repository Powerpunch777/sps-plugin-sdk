import assert from "node:assert/strict";
import test from "node:test";
import {
  SPS_PLUGIN_AUTHORING_V1_SCHEMA,
  appendSpsPluginAuthoringEvidenceV1,
  createSpsPluginAuthoringSessionV1,
  defineSpsPluginAuthoringRequestV1,
  defineSpsPluginAuthoringResultV1,
} from "./typed-contract-v1.mjs";

const session = "spsas_0123456789abcdef";
const evidence = "spsae_0123456789abcdef";

test("authoring requests classify all v1 operations into separate provider-neutral namespaces", () => {
  const cases = [
    ["searchCatalog", { query: "project workplane", limit: 5 }, "catalog"],
    ["getCatalogPlugin", { pluginId: "com.example.demo", version: "1.2.3", source: "official" }, "catalog"],
    ["createPluginProject", { templateId: "sps.template.basic", displayName: "My Builder" }, "project"],
    ["runAuthoringStep", { projectId: "sps.project.demo", step: "build" }, "build"],
    ["inspectBuild", { projectId: "sps.project.demo", buildId: "sps.build.001" }, "build"],
    ["openPreview", { projectId: "sps.project.demo", buildId: "sps.build.001", surface: "dashboard" }, "preview"],
  ];
  for (const [operation, input, namespace] of cases) {
    const value = defineSpsPluginAuthoringRequestV1({ authoringSessionId: session, operation, input, evidenceRefs: [evidence] });
    assert.equal(value.schemaVersion, SPS_PLUGIN_AUTHORING_V1_SCHEMA);
    assert.equal(value.namespace, namespace);
    assert.equal(Object.isFrozen(value), true);
  }
});

test("plugin project requests use only current Core capability names", () => {
  const request = defineSpsPluginAuthoringRequestV1({
    authoringSessionId: session,
    operation: "createPluginProject",
    input: {
      templateId: "sps.template.basic",
      displayName: "My Builder",
      requestedCapabilities: ["ui.workspaceShell.provide", "ui.dashboard.contribute", "inbox.items.publish"],
    },
  });
  assert.deepEqual(request.input.requestedCapabilities, ["inbox.items.publish", "ui.dashboard.contribute", "ui.workspaceShell.provide"]);
  assert.throws(() => defineSpsPluginAuthoringRequestV1({
    authoringSessionId: session,
    operation: "createPluginProject",
    input: { templateId: "sps.template.basic", displayName: "My Builder", requestedCapabilities: ["workspace.shell.register"] },
  }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
});

test("authoring result contracts accept only safe, typed output for every v1 operation", () => {
  const hash = "a".repeat(64);
  const cases = [
    ["searchCatalog", { matches: [{ pluginId: "com.example.demo", version: "1.2.3", title: "Demo", summary: "A safe summary", source: "official" }] }],
    ["getCatalogPlugin", { plugin: { pluginId: "com.example.demo", version: "1.2.3", title: "Demo", summary: "A safe summary", source: "official", publisher: "Example Studio", categories: ["workflow"], capabilities: ["agent.tools.register"] } }],
    ["createPluginProject", { projectId: "sps.project.demo", state: "created" }],
    ["runAuthoringStep", { projectId: "sps.project.demo", buildId: "sps.build.001", step: "build", outcome: "completed" }],
    ["inspectBuild", { projectId: "sps.project.demo", buildId: "sps.build.001", status: "valid", manifestSha256: hash, workerSha256: hash }],
    ["openPreview", { projectId: "sps.project.demo", buildId: "sps.build.001", previewId: "sps.preview.001", state: "ready" }],
  ];
  for (const [operation, output] of cases) {
    const value = defineSpsPluginAuthoringResultV1({ authoringSessionId: session, operation, status: "completed", output, evidenceRefs: [evidence] });
    assert.equal(value.operation, operation);
    assert.notEqual(value.namespace, "lifecycle");
  }
});

test("authoring contract rejects plugin mutation operations", () => {
  assert.throws(() => defineSpsPluginAuthoringRequestV1({
    authoringSessionId: session,
    operation: "installPlugin",
    input: {},
  }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
  assert.throws(() => defineSpsPluginAuthoringResultV1({
    authoringSessionId: session,
    operation: "activatePlugin",
    status: "completed",
    output: {},
  }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
});

test("catalog detail is read-only, bounded, and rejects unknown fields", () => {
  const detail = defineSpsPluginAuthoringResultV1({
    authoringSessionId: session,
    operation: "getCatalogPlugin",
    status: "completed",
    output: { plugin: { pluginId: "com.example.demo", version: "1.2.3", title: "Demo", summary: "Details", source: "official", publisher: "Example Studio", categories: ["workflow"], capabilities: ["agent.tools.register"] } },
  });
  assert.equal(detail.namespace, "catalog");
  assert.equal(detail.output.plugin.publisher, "Example Studio");
  assert.throws(() => defineSpsPluginAuthoringResultV1({
    authoringSessionId: session,
    operation: "getCatalogPlugin",
    status: "completed",
    output: { plugin: { pluginId: "com.example.demo", version: "1.2.3", title: "Demo", summary: "Details", source: "official", installCommand: "npm install demo" } },
  }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
});

test("append-only authoring evidence preserves earlier records and rejects duplicate references", () => {
  const empty = createSpsPluginAuthoringSessionV1(session);
  const one = appendSpsPluginAuthoringEvidenceV1(empty, { evidenceRef: evidence, operation: "searchCatalog", kind: "request", summary: "Search requested", occurredAt: "2026-07-31T00:00:00.000Z" });
  const two = appendSpsPluginAuthoringEvidenceV1(one, { evidenceRef: "spsae_0123456789abcdee", operation: "searchCatalog", kind: "result", summary: "Search returned two matches", occurredAt: "2026-07-31T00:00:01.000Z" });
  assert.equal(empty.evidence.length, 0);
  assert.equal(one.evidence.length, 1);
  assert.equal(two.evidence.length, 2);
  assert.equal(Object.isFrozen(two.evidence), true);
  assert.throws(() => appendSpsPluginAuthoringEvidenceV1(two, { evidenceRef: evidence, operation: "searchCatalog", kind: "result", summary: "Duplicate", occurredAt: "2026-07-31T00:00:02.000Z" }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
});

test("authoring contracts reject paths, credentials, raw provider shapes, and unsupported operations deterministically", () => {
  assert.throws(() => defineSpsPluginAuthoringRequestV1({ authoringSessionId: session, operation: "searchCatalog", input: { query: "C:\\Users\\private" } }), { code: "SPS_PLUGIN_AUTHORING_UNSAFE" });
  assert.throws(() => defineSpsPluginAuthoringResultV1({ authoringSessionId: session, operation: "searchCatalog", status: "completed", output: { matches: [{ pluginId: "com.example.demo", version: "1.0.0", title: "Demo", summary: "token=super-secret", source: "official" }] } }), { code: "SPS_PLUGIN_AUTHORING_UNSAFE" });
  assert.throws(() => defineSpsPluginAuthoringRequestV1({ authoringSessionId: session, operation: "searchCatalog", input: { query: "safe", command: "npm install" } }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
  assert.throws(() => defineSpsPluginAuthoringRequestV1({ authoringSessionId: session, operation: "installPlugin", input: {} }), { code: "SPS_PLUGIN_AUTHORING_INVALID" });
});
