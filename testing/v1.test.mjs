import assert from "node:assert/strict";
import test from "node:test";
import { createSpsPluginTestKitV1 } from "./v1.mjs";

test("Test Kit models Host, Member, Node, Runtime, Source, and UI state transitions deterministically", () => {
  const kit = createSpsPluginTestKitV1();
  assert.equal(kit.setWorkspaceState({ status: "offline" }).status, "offline");
  assert.equal(kit.setHostState({ status: "stopped" }).status, "stopped");
  assert.equal(kit.setMemberState({ status: "offline" }).status, "offline");
  assert.equal(kit.setNodeState({ status: "revoked" }).status, "revoked");
  assert.equal(kit.setRuntimeState({ status: "busy" }).status, "busy");
  assert.equal(kit.setSourceState({ status: "removed" }).status, "removed");
  assert.equal(kit.setUiState("dashboard", "permission").dashboard, "permission");
  assert.equal(Object.isFrozen(kit.snapshot()), true);
  assert.throws(() => kit.setNodeState({ id: "missing", status: "online" }), /does not exist/);
});

test("Test Kit models capability denials, network loss, tool/event/stream/connector/MCP and visibility", () => {
  const kit = createSpsPluginTestKitV1();
  assert.equal(kit.invokeTool({ id: "tool-build" }).status, "completed");
  assert.equal(kit.emitEvent({ id: "event-build" }).status, "completed");
  assert.equal(kit.openStream({ id: "stream-build" }).status, "completed");
  assert.equal(kit.useConnector({ id: "connector-build" }).status, "completed");
  assert.equal(kit.useMcp({ id: "mcp-build" }).status, "completed");
  assert.equal(kit.createBackup({ id: "backup-build" }).status, "completed");
  assert.equal(kit.setVisibility({ audience: "member", state: "permission" }).member, "permission");
  kit.disconnect();
  assert.throws(() => kit.useConnector({ id: "connector-offline" }), (error) => error.code === "SPS_PLUGIN_NETWORK_DISCONNECTED");
  kit.reconnect();
  kit.deny("tool.invoke");
  assert.throws(() => kit.invokeTool(), (error) => error.code === "SPS_PLUGIN_CAPABILITY_DENIED");
  assert.ok(kit.diagnostics.some((entry) => entry.code === "CAPABILITY_DENIED"));
});

test("Test Kit lifecycle, migration, rollback, delete, and restart preserve deterministic recoverable work", () => {
  const kit = createSpsPluginTestKitV1();
  kit.scheduleJob({ id: "recoverable", recoverable: true });
  kit.scheduleJob({ id: "discarded", recoverable: false });
  kit.dispatchRun({ id: "run-main" });
  kit.update({ version: "1.1.0", migration: { id: "upgrade", outcome: "pass" } });
  assert.equal(kit.rollback().version, "1.0.0");
  const restarted = kit.restart();
  assert.equal(restarted.jobs.find((job) => job.id === "recoverable").status, "recovered");
  assert.equal(restarted.jobs.find((job) => job.id === "discarded").status, "queued");
  assert.equal(restarted.runs[0].status, "recovering");
  assert.throws(() => kit.update({ version: "1.2.0", migration: { outcome: "fail" } }), /Migration failed/);
  kit.delete();
  assert.throws(() => kit.scheduleJob(), /not active/);
});

test("Test Kit timestamps stay valid after more than one minute of diagnostics and report is safe", () => {
  const kit = createSpsPluginTestKitV1();
  for (let index = 0; index < 80; index += 1) kit.invokeTool({ id: `tool-${index}` });
  const events = kit.diagnostics;
  assert.equal(events.length, 80);
  assert.ok(events.every((entry) => entry.occurredAt === new Date(entry.occurredAt).toISOString()));
  assert.equal(Object.isFrozen(events), true);
  const report = kit.createConformanceReport({ metadata: { runner: "sdk" } });
  assert.equal(report.status, "passed");
  assert.equal(report.diagnostics.length, 80);
});

test("Test Kit rejects unsafe semver, accessors, and unsupported input", () => {
  assert.throws(() => createSpsPluginTestKitV1({ pluginVersion: "1.0" }), /semantic/);
  const accessor = {}; Object.defineProperty(accessor, "pluginId", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => createSpsPluginTestKitV1(accessor), /accessors/);
  const kit = createSpsPluginTestKitV1();
  assert.throws(() => kit.invokeTool({ label: "C:\\Users\\private" }), /safe/);
  assert.throws(() => kit.setVisibility({ audience: "visitor", state: "visible" }), /invalid/);
});
