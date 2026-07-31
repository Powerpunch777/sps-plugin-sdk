import assert from "node:assert/strict";
import test from "node:test";
import { createSpsPluginDiagnosticSinkV1, normalizeSpsPluginDiagnosticEventV1, SpsPluginDiagnosticError } from "./v1.mjs";

const event = (overrides = {}) => ({ id: "event-1", origin: "plugin", category: "tool", level: "info", code: "TOOL_INVOKED", message: "Tool finished safely.", occurredAt: "2026-01-01T00:00:00.000Z", details: { count: 1 }, ...overrides });

test("diagnostics normalizes immutable bounded structured evidence", () => {
  const result = normalizeSpsPluginDiagnosticEventV1(event({ details: { nested: [true, { count: 2 }] } }));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.details.nested), true);
  assert.deepEqual(result.details, { nested: [true, { count: 2 }] });
});

test("diagnostics rejects malformed ISO timestamps, credentials, paths, cycles, accessors, and oversize data", () => {
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ occurredAt: "2026-01-01T00:00:00Z" })), SpsPluginDiagnosticError);
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ occurredAt: "2026-13-01T00:00:00.000Z" })), SpsPluginDiagnosticError);
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ message: "Bearer a-very-secret-token-value" })), SpsPluginDiagnosticError);
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ details: { location: "C:\\Users\\private" } })), SpsPluginDiagnosticError);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ details: cyclic })), SpsPluginDiagnosticError);
  const accessor = {}; Object.defineProperty(accessor, "count", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ details: accessor })), SpsPluginDiagnosticError);
  assert.throws(() => normalizeSpsPluginDiagnosticEventV1(event({ details: { text: "x".repeat(17_000) } })), SpsPluginDiagnosticError);
});

test("diagnostic sink never exposes its mutable backing array", () => {
  const sink = createSpsPluginDiagnosticSinkV1({ maxEvents: 2 });
  sink.emit(event());
  const firstRead = sink.events;
  assert.equal(Object.isFrozen(firstRead), true);
  assert.throws(() => firstRead.push(event({ id: "event-2" })), TypeError);
  sink.emit(event({ id: "event-2" })); sink.emit(event({ id: "event-3" }));
  assert.deepEqual(sink.read().map((item) => item.id), ["event-2", "event-3"]);
  assert.notEqual(sink.events, sink.events);
  sink.clear();
  assert.deepEqual(sink.events, []);
});
