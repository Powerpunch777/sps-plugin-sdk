import assert from "node:assert/strict";
import test from "node:test";
import {
  SPS_PLATFORM_CAPABILITIES,
  assertJsonValue,
  defineSpsStateKey,
  defineSpsPlatformContract,
  isJsonValue,
} from "./index.mjs";
import { SPS_CORE_PRIMITIVES } from "../profile/extension-profile-v2.mjs";

test("declares the Core-mapped tool, event, job, data, and state surface", () => {
  const tool = async () => ({ content: "ok", data: { ok: true } });
  const dataProvider = async () => ({ status: "ok" });
  const contract = defineSpsPlatformContract({
    capabilities: SPS_PLATFORM_CAPABILITIES,
    tools: [{ name: "search.docs", declaration: { displayName: "Search docs", description: "Searches docs", parametersSchema: { type: "object" } }, handler: tool }],
    events: [{ name: "document.changed", filter: { source: "sync" }, handler: async () => undefined }],
    jobs: [{ jobKey: "refresh.index", handler: async () => undefined }],
    data: [{ key: "workspace.status", handler: dataProvider }],
  });

  assert.deepEqual(contract.capabilities, SPS_PLATFORM_CAPABILITIES);
  assert.equal(contract.tools[0].handler, tool);
  assert.equal(contract.events[0].name, "document.changed");
  assert.equal(contract.jobs[0].jobKey, "refresh.index");
  assert.equal(contract.data[0].handler, dataProvider);
  assert(Object.isFrozen(contract));
  assert(Object.isFrozen(contract.tools));
  assert(Object.isFrozen(contract.tools[0]));
  assert(Object.isFrozen(contract.data));
});

test("uses Core plugin state keys without inventing store registration", () => {
  assert.deepEqual(defineSpsStateKey({ scopeKind: "project_workspace", scopeId: "workspace-1", namespace: "cache", stateKey: "cursor" }), {
    scopeKind: "project_workspace",
    scopeId: "workspace-1",
    namespace: "cache",
    stateKey: "cursor",
  });
  assert.throws(() => defineSpsStateKey({ scopeKind: "room", stateKey: "cursor" }), /scopeKind/);
  assert.throws(() => defineSpsStateKey({ scopeKind: "instance" }), /stateKey/);
});

test("rejects undeclared capabilities, invalid registrations, and duplicate names", () => {
  assert.throws(() => defineSpsPlatformContract({ capabilities: ["host.execute"] }), /Unsupported SPS Platform capabilities/);
  assert.throws(() => defineSpsPlatformContract({ capabilities: ["agent.tools.register", "agent.tools.register"] }), /duplicates/);
  assert.throws(() => defineSpsPlatformContract({ tools: [{ name: "tool", declaration: { displayName: "Tool", description: "Does work", parametersSchema: [] }, handler() {} }] }), /parametersSchema/);
  assert.throws(() => defineSpsPlatformContract({ events: [{ name: "changed", handler: true }] }), /event handler/);
  assert.throws(() => defineSpsPlatformContract({ jobs: [{ jobKey: "sync", handler() {} }, { jobKey: "sync", handler() {} }] }), /duplicate/);
  assert.throws(() => defineSpsPlatformContract({ data: [{ key: "status", handler() {} }, { key: "status", handler() {} }] }), /duplicate/);
});

test("declares bounded agent-session run read and cancellation capabilities", () => {
  assert.ok(SPS_PLATFORM_CAPABILITIES.includes("agent.sessions.read"));
  assert.ok(SPS_PLATFORM_CAPABILITIES.includes("agent.sessions.cancel"));
  const contract = defineSpsPlatformContract({ capabilities: ["agent.sessions.read", "agent.sessions.cancel"] });
  assert.deepEqual(contract.capabilities, ["agent.sessions.read", "agent.sessions.cancel"]);
});

test("declares the separate model-request capabilities without adding Core primitives", () => {
  const capabilities = ["sps.models.read", "sps.models.submit", "sps.models.cancel"];
  assert.ok(capabilities.every((capability) => SPS_PLATFORM_CAPABILITIES.includes(capability)));
  assert.ok(capabilities.every((capability) => !SPS_CORE_PRIMITIVES.includes(capability)));
  assert.deepEqual(defineSpsPlatformContract({ capabilities }).capabilities, capabilities);
});

test("declares common execution reads alongside model requests in a portable Worker", () => {
  const capabilities = ["sps.models.read", "sps.models.submit", "sps.models.cancel", "sps.executions.read"];
  assert.deepEqual(defineSpsPlatformContract({ capabilities }).capabilities, capabilities);
  assert.deepEqual(defineSpsPlatformContract({ capabilities: ["sps.executions.read"] }).capabilities, ["sps.executions.read"]);
});

test("accepts only finite, acyclic plain JSON payloads", () => {
  assert.equal(isJsonValue({ values: [null, false, 0, "ok"] }), true);
  assert.deepEqual(assertJsonValue({ ok: true }), { ok: true });

  const cyclic = {};
  cyclic.self = cyclic;
  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = "no";
  const sparse = [];
  sparse[1] = "missing first value";

  for (const invalid of [NaN, Infinity, -Infinity, cyclic, customPrototype, new Date(), sparse, { fn() {} }]) {
    assert.equal(isJsonValue(invalid), false);
    assert.throws(() => assertJsonValue(invalid), /plain JSON/);
  }
});
