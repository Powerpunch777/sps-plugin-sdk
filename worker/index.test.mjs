import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { defineSpsPlugin, runSpsWorker } from "./index.mjs";
import { defineSpsPlatformContract } from "../platform/index.mjs";

function createHarness(plugin) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  const logs = [];
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  return { input, lines, logs, worker: runSpsWorker(plugin, { input, output, logger: (message) => logs.push(message) }) };
}

async function eventually(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Timed out waiting for Worker protocol output.");
}

test("portable Worker correlates finite Runtime requests across lifecycle messages", async () => {
  const plugin = defineSpsPlugin({
    async initialize({ spsTransport }) {
      const runtimes = await spsTransport.request("sps.runtimes.list", { companyId: "company-1" });
      return { initialized: Array.isArray(runtimes) };
    },
    health() { return { status: "ok" }; },
    shutdown() { return { stopped: true }; },
  });
  const { input, lines, worker } = createHarness(plugin);
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
  await eventually(() => lines.length === 1);
  assert.deepEqual(lines[0], { jsonrpc: "2.0", id: "sps-1", method: "sps.runtimes.list", params: { companyId: "company-1" } });
  input.write('{"jsonrpc":"2.0","id":"sps-1","result":[]}\n');
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: ["health", "shutdown"] } });
  input.write('{"jsonrpc":"2.0","id":2,"method":"health"}\n');
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], { jsonrpc: "2.0", id: 2, result: { status: "ok" } });
  input.write('{"jsonrpc":"2.0","id":3,"method":"shutdown"}\n');
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3], { jsonrpc: "2.0", id: 3, result: { stopped: true } });
  await worker.closed;
});

test("Worker rejects unsupported Runtime operations before protocol output and reports malformed input as JSON-RPC errors", async () => {
  const plugin = defineSpsPlugin({
    async initialize({ spsTransport }) {
      await assert.rejects(spsTransport.request("companies.list", {}), /Unsupported SPS Runtime operation/);
      return { ok: true };
    },
  });
  const { input, lines, logs, worker } = createHarness(plugin);
  input.write("not json\n");
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines, [
    { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
    { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: [] } },
  ]);
  assert.equal(logs.length, 0);
  input.end();
  await worker.closed;
});

test("Worker gates health, repeated initialization, and Runtime requests after shutdown", async () => {
  let capturedTransport;
  const plugin = defineSpsPlugin({
    initialize({ spsTransport }) { capturedTransport = spsTransport; },
    health() { return { status: "ok" }; },
    shutdown() { return { stopped: true }; },
  });
  const { input, lines, worker } = createHarness(plugin);
  input.write('{"jsonrpc":"2.0","id":1,"method":"health"}\n');
  await eventually(() => lines.length === 1);
  assert.deepEqual(lines[0], { jsonrpc: "2.0", id: 1, error: { code: -32002, message: "SPS Worker is not initialized." } });
  input.write('{"jsonrpc":"2.0","id":2,"method":"initialize"}\n');
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], { jsonrpc: "2.0", id: 2, result: { ok: true, supportedMethods: ["health", "shutdown"] } });
  input.write('{"jsonrpc":"2.0","id":3,"method":"initialize"}\n');
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], { jsonrpc: "2.0", id: 3, error: { code: -32001, message: "SPS Worker has already been initialized." } });
  input.write('{"jsonrpc":"2.0","id":4,"method":"shutdown"}\n');
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3], { jsonrpc: "2.0", id: 4, result: { stopped: true } });
  await worker.closed;
  await assert.rejects(capturedTransport.request("sps.runtimes.list", { companyId: "company-1" }), /transport is closed/);
});

test("Worker reports an invalid JSON-RPC request on stdout", async () => {
  const { input, lines, worker } = createHarness(defineSpsPlugin({}));
  input.write('{"jsonrpc":"1.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  assert.deepEqual(lines[0], { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } });
  input.end();
  await worker.closed;
});

test("Host RPC errors and stream shutdown reject pending Runtime requests", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const plugin = defineSpsPlugin({
    async initialize({ spsTransport }) {
      try { await spsTransport.request("sps.runs.get", { companyId: "company-1", runId: "run-1" }); }
      catch (cause) { release(cause.message); }
      return null;
    },
  });
  const { input, lines, worker } = createHarness(plugin);
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  input.write('{"jsonrpc":"2.0","id":"sps-1","error":{"code":403,"message":"Denied"}}\n');
  assert.equal(await pending, "Denied");
  input.end();
  await worker.closed;
});

test("input stream closure rejects a pending Runtime request without leaving Worker work behind", async () => {
  let release;
  const rejected = new Promise((resolve) => { release = resolve; });
  const plugin = defineSpsPlugin({
    async initialize({ spsTransport }) {
      try { await spsTransport.request("sps.runs.get", { companyId: "company-1", runId: "run-1" }); }
      catch (cause) { release(cause.message); }
      return null;
    },
  });
  const { input, lines, worker } = createHarness(plugin);
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  input.end();
  assert.match(await rejected, /input stream closed/);
  await worker.closed;
});

test("declared platform registers events, dispatches tool/event/job handlers, and bridges state and events without capability gating", async () => {
  const calls = [];
  const platform = defineSpsPlatformContract({
    events: [{ name: "document.changed", filter: { source: "sync" }, async handler(event, api) {
      calls.push(["event", event.eventId]);
      await api.events.emit("document.indexed", event.companyId, { eventId: event.eventId });
    } }],
    tools: [{ name: "search.docs", declaration: { displayName: "Search", description: "Searches", parametersSchema: { type: "object" } }, async handler(params, context, api) {
      calls.push(["tool", params.query, context.runId]);
      const previous = await api.state.get({ scopeKind: "run", scopeId: context.runId, stateKey: "cursor" });
      await api.state.set({ scopeKind: "run", scopeId: context.runId, stateKey: "cursor" }, { query: params.query });
      await api.state.delete({ scopeKind: "run", scopeId: context.runId, stateKey: "obsolete" });
      return { content: previous?.value ?? "none" };
    } }],
    jobs: [{ jobKey: "refresh.index", handler(job) { calls.push(["job", job.runId]); } }],
  });
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform }));
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  assert.deepEqual(lines[0], { jsonrpc: "2.0", id: "sps-1", method: "events.subscribe", params: { eventPattern: "document.changed", filter: { source: "sync" } } });
  input.write('{"jsonrpc":"2.0","id":"sps-1","result":null}\n');
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: ["executeTool", "onEvent", "runJob"] } });

  input.write('{"jsonrpc":"2.0","id":2,"method":"executeTool","params":{"toolName":"search.docs","parameters":{"query":"sdk"},"runContext":{"runId":"run-1","companyId":"company-1"}}}\n');
  await eventually(() => lines.length === 3);
  assert.equal(lines[2].method, "state.get");
  input.write(`{"jsonrpc":"2.0","id":"${lines[2].id}","result":{"value":"before"}}\n`);
  await eventually(() => lines.length === 4);
  assert.equal(lines[3].method, "state.set");
  input.write(`{"jsonrpc":"2.0","id":"${lines[3].id}","result":null}\n`);
  await eventually(() => lines.length === 5);
  assert.equal(lines[4].method, "state.delete");
  input.write(`{"jsonrpc":"2.0","id":"${lines[4].id}","result":null}\n`);
  await eventually(() => lines.length === 6);
  assert.deepEqual(lines[5], { jsonrpc: "2.0", id: 2, result: { content: "before" } });

  input.write('{"jsonrpc":"2.0","id":3,"method":"onEvent","params":{"event":{"eventId":"event-1","eventType":"document.changed","companyId":"company-1","payload":{}}}}\n');
  await eventually(() => lines.length === 7);
  assert.deepEqual(lines[6], { jsonrpc: "2.0", id: "sps-5", method: "events.emit", params: { name: "document.indexed", companyId: "company-1", payload: { eventId: "event-1" } } });
  input.write('{"jsonrpc":"2.0","id":"sps-5","result":null}\n');
  await eventually(() => lines.length === 8);
  assert.deepEqual(lines[7], { jsonrpc: "2.0", id: 3, result: null });
  input.write('{"jsonrpc":"2.0","id":4,"method":"runJob","params":{"job":{"jobKey":"refresh.index","runId":"job-run"}}}\n');
  await eventually(() => lines.length === 9);
  assert.deepEqual(lines[8], { jsonrpc: "2.0", id: 4, result: null });
  assert.deepEqual(calls, [["tool", "sdk", "run-1"], ["event", "event-1"], ["job", "job-run"]]);
  input.end();
  await worker.closed;
});

test("declared platform serves UI data through the Core plugin bridge", async () => {
  const platform = defineSpsPlatformContract({
    data: [{ key: "workspace.status", async handler(params, api) {
      const value = await api.state.get({ scopeKind: "company", scopeId: params.companyId, stateKey: "status" });
      return { companyId: params.companyId, filter: params.filter, value };
    } }],
  });
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform }));
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  assert.deepEqual(lines[0], { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: ["executeTool", "onEvent", "runJob", "getData"] } });
  input.write('{"jsonrpc":"2.0","id":2,"method":"getData","params":{"key":"workspace.status","companyId":"company-1","params":{"filter":"active"},"renderEnvironment":{"surface":"desktop"}}}\n');
  await eventually(() => lines.length === 2);
  assert.equal(lines[1].method, "state.get");
  input.write(`{"jsonrpc":"2.0","id":"${lines[1].id}","result":{"ready":true}}\n`);
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], { jsonrpc: "2.0", id: 2, result: { companyId: "company-1", filter: "active", value: { ready: true } } });
  input.end();
  await worker.closed;
});

test("platform rejects unknown dispatch keys and preserves concurrent Core invocation IDs", async () => {
  const platform = defineSpsPlatformContract({
    tools: [{ name: "stateful", declaration: { displayName: "Stateful", description: "Stores", parametersSchema: {} }, async handler(params, _context, api) {
      return api.state.get({ scopeKind: "run", scopeId: params.id, stateKey: "value" });
    } }],
  });
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform }));
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  assert.deepEqual(lines[0], { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: ["executeTool", "onEvent", "runJob"] } });
  input.write('{"jsonrpc":"2.0","id":2,"method":"executeTool","paperclipInvocation":{"id":"one","scope":{"companyId":"c1"}},"params":{"toolName":"stateful","parameters":{"id":"one"},"runContext":{}}}\n');
  input.write('{"jsonrpc":"2.0","id":3,"method":"executeTool","paperclipInvocation":{"id":"two","scope":{"companyId":"c2"}},"params":{"toolName":"stateful","parameters":{"id":"two"},"runContext":{}}}\n');
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines.slice(1).map(({ paperclipInvocationId, params }) => ({ paperclipInvocationId, scopeId: params.scopeId })).sort((a, b) => a.scopeId.localeCompare(b.scopeId)), [
    { paperclipInvocationId: "one", scopeId: "one" }, { paperclipInvocationId: "two", scopeId: "two" },
  ]);
  for (const line of lines.slice(1)) input.write(`{"jsonrpc":"2.0","id":"${line.id}","result":null}\n`);
  await eventually(() => lines.length === 5);
  input.write('{"jsonrpc":"2.0","id":4,"method":"executeTool","params":{"toolName":"missing","parameters":{},"runContext":{}}}\n');
  input.write('{"jsonrpc":"2.0","id":5,"method":"notSupported"}\n');
  await eventually(() => lines.length === 7);
  assert.equal(lines[5].error.code, -32601);
  assert.equal(lines[6].error.code, -32601);
  input.end();
  await worker.closed;
});

test("accepts Core onEvent notifications without emitting a response", async () => {
  const observed = [];
  const platform = defineSpsPlatformContract({
    events: [{ name: "project.updated", async handler(event, api) {
      observed.push(event.eventId);
      await api.events.emit("project.indexed", event.companyId, { eventId: event.eventId });
    } }],
  });
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform }));
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await eventually(() => lines.length === 1);
  assert.equal(lines[0].method, "events.subscribe");
  input.write(`{"jsonrpc":"2.0","id":"${lines[0].id}","result":null}\n`);
  await eventually(() => lines.length === 2);

  input.write('{"jsonrpc":"2.0","method":"onEvent","paperclipInvocation":{"id":"event-invocation","scope":{"companyId":"company-1"}},"params":{"event":{"eventId":"event-1","eventType":"project.updated","occurredAt":"2026-07-31T00:00:00.000Z","companyId":"company-1","payload":{}}}}\n');
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], {
    jsonrpc: "2.0",
    id: "sps-2",
    method: "events.emit",
    params: { name: "project.indexed", companyId: "company-1", payload: { eventId: "event-1" } },
    paperclipInvocationId: "event-invocation",
  });
  input.write('{"jsonrpc":"2.0","id":"sps-2","result":null}\n');
  await eventually(() => observed.length === 1);
  assert.equal(lines.length, 3);
  input.end();
  await worker.closed;
});
