import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { defineSpsPlugin, runSpsWorker } from "./index.mjs";
import { defineSpsPlatformContract } from "../platform/index.mjs";

test("UI actions use immutable Host scope and reject missing actor metadata", async () => {
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    actions: [{ key: "scope", handler: (_params, context) => ({ companyId: context.companyId, actor: context.actor.type, frozen: Object.isFrozen(context.actor) }) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{} })+"\n");
  await eventually(()=>lines.length===1);
  assert.ok(lines[0].result.supportedMethods.includes("performAction"));
  input.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"performAction",params:{key:"scope",params:{companyId:"spoof"},actorContext:{type:"user",companyId:"a",userId:"user"}}})+"\n");
  await eventually(()=>lines.length===2);
  assert.deepEqual(lines[1].result,{companyId:"a",actor:"user",frozen:true});
  input.write(JSON.stringify({jsonrpc:"2.0",id:3,method:"performAction",params:{key:"scope",companyId:"a",params:{}}})+"\n");
  await eventually(()=>lines.length===3); assert.ok(lines[2].error);
  input.end(); await worker.closed;
});

test("Agent session callbacks receive terminal events and are released once", async () => {
  const events=[];
  const {input,lines,worker}=createHarness(defineSpsPlugin({platform:defineSpsPlatformContract({
    capabilities:["agent.sessions.send"],
    actions:[{key:"send",handler:(_params,context)=>context.agents.sessions.sendMessage("s","a",{prompt:"hello",onEvent:event=>events.push(event.eventType)})}],
  })}));
  input.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{}})+"\n");await eventually(()=>lines.length===1);
  input.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"performAction",params:{key:"send",companyId:"a",params:{},actorContext:{type:"user",companyId:"a",userId:"u"}}})+"\n");
  await eventually(()=>lines.length===2);assert.equal(lines[1].method,"agents.sessions.sendMessage");
  input.write(JSON.stringify({jsonrpc:"2.0",id:lines[1].id,result:{runId:"r"}})+"\n");await eventually(()=>lines.length===3);
  for(const eventType of ["chunk","done","done"])input.write(JSON.stringify({jsonrpc:"2.0",method:"agents.sessions.event",params:{sessionId:"s",eventType,message:"ok"}})+"\n");
  await eventually(()=>events.length===2);assert.deepEqual(events,["chunk","done"]);
  input.end();await worker.closed;
});

test("Agent execution descriptors use the exact read-only RPC and authenticated tenant", async () => {
  const descriptor = {
    agentId: "agent-1",
    adapterType: "openai",
    state: "configured",
    adapterRegistration: "registered",
    executionOwner: "adapter",
    authorization: "recheck_on_dispatch",
    readiness: "unknown",
    node: null,
  };
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agents.read"],
    actions: [{ key: "describe", handler: (_params, context) => context.agents.describeExecution("agent-1", "company-1") }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-describe", scope: { companyId: "company-1" } },
    params: { key: "describe", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], {
    jsonrpc: "2.0", id: "sps-1", method: "agents.describeExecution",
    params: { agentId: "agent-1", companyId: "company-1" },
    paperclipInvocationId: "inv-describe",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-1", result: descriptor }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], { jsonrpc: "2.0", id: 2, result: descriptor });
  input.end();
  await worker.closed;
});

test("Agent execution descriptor denies missing capability and missing or cross-company scope before Host calls", async () => {
  const cases = [
    {
      capabilities: [],
      platform: { actions: [{ key: "describe", handler: (_params, context) => context.agents.describeExecution("agent-1", "company-1") }] },
      invocation: { id: "inv-denied", scope: { companyId: "company-1" } },
      params: { key: "describe", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
      expected: /Undeclared.*agents\.read/,
    },
    {
      capabilities: ["agents.read"],
      platform: { data: [{ key: "describe", handler: (_params, context) => context.agents.describeExecution("agent-1", "company-1") }] },
      params: { key: "describe", params: {} },
      expected: /authenticated invocation company/,
    },
    {
      capabilities: ["agents.read"],
      platform: { actions: [{ key: "describe", handler: (_params, context) => context.agents.describeExecution("agent-1", "company-2") }] },
      invocation: { id: "inv-cross-company", scope: { companyId: "company-1" } },
      params: { key: "describe", params: {}, actorContext: { type: "user", companyId: "company-2" } },
      expected: /authenticated invocation company/,
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
      capabilities: scenario.capabilities,
      ...scenario.platform,
    }) }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: scenario.platform.data ? "getData" : "performAction",
      ...(scenario.invocation ? { paperclipInvocation: scenario.invocation } : {}),
      params: scenario.params,
    }) + "\n");
    await eventually(() => lines.length === 2);
    assert.match(lines[1].error.message, scenario.expected, `case ${index}`);
    assert.equal(lines.some((line) => line.method === "agents.describeExecution"), false);
    input.end();
    await worker.closed;
  }
});

test("Agent execution descriptor rejects invalid identifiers before Host calls", async () => {
  const invalidArguments = [
    ["", "company-1"],
    ["   ", "company-1"],
    ["a".repeat(161), "company-1"],
    [7, "company-1"],
    ["agent-1", ""],
    ["agent-1", "company-" + "a".repeat(153)],
    ["agent-1", null],
  ];
  for (const [index, [agentId, companyId]] of invalidArguments.entries()) {
    const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
      capabilities: ["agents.read"],
      actions: [{ key: "describe", handler: (_params, context) => context.agents.describeExecution(agentId, companyId) }],
    }) }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "performAction",
      paperclipInvocation: { id: `inv-invalid-${index}`, scope: { companyId: "company-1" } },
      params: { key: "describe", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
    }) + "\n");
    await eventually(() => lines.length === 2);
    assert.match(lines[1].error.message, /agentId|companyId/);
    assert.equal(lines.some((line) => line.method === "agents.describeExecution"), false);
    input.end();
    await worker.closed;
  }
});

test("Agent session run inspection and cancellation use the exact bounded Core requests", async () => {
  const inspected = { runId: "run-1", status: "running", cancellationRequested: false, termination: "not_applicable", errorCode: null, error: null };
  const cancellation = { runId: "run-1", status: "cancelling", cancellationRequested: true, termination: "pending", errorCode: null, error: null };
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.read", "agent.sessions.cancel"],
    actions: [{ key: "run", handler: async (_params, context) => ({
      inspected: await context.agents.sessions.getRun("session-1", "company-1", "run-1"),
      cancellation: await context.agents.sessions.cancel("session-1", "company-1", "run-1"),
    }) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-1", scope: { companyId: "company-1" } },
    params: { key: "run", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], {
    jsonrpc: "2.0", id: "sps-1", method: "agents.sessions.getRun",
    params: { sessionId: "session-1", companyId: "company-1", runId: "run-1" },
    paperclipInvocationId: "inv-1",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-1", result: inspected }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], {
    jsonrpc: "2.0", id: "sps-2", method: "agents.sessions.cancel",
    params: { sessionId: "session-1", companyId: "company-1", runId: "run-1" },
    paperclipInvocationId: "inv-1",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-2", result: cancellation }) + "\n");
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3], { jsonrpc: "2.0", id: 2, result: { inspected, cancellation } });
  input.end();
  await worker.closed;
});

test("Agent session run methods enforce their dedicated capabilities and invocation tenant", async () => {
  const cases = [
    { capabilities: ["agent.sessions.cancel"], expected: /Undeclared.*agent\.sessions\.read/, invoke: (agents) => agents.sessions.getRun("s", "company-1", "r") },
    { capabilities: ["agent.sessions.read"], expected: /Undeclared.*agent\.sessions\.cancel/, invoke: (agents) => agents.sessions.cancel("s", "company-1", "r") },
    { capabilities: ["agent.sessions.read"], expected: /authenticated invocation company/, invoke: (agents) => agents.sessions.getRun("s", "company-2", "r") },
  ];
  for (const [index, scenario] of cases.entries()) {
    const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
      capabilities: scenario.capabilities,
      actions: [{ key: "run", handler: (_params, context) => scenario.invoke(context.agents) }],
    }) }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "performAction",
      paperclipInvocation: { id: `inv-${index}`, scope: { companyId: "company-1" } },
      params: { key: "run", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
    }) + "\n");
    await eventually(() => lines.length === 2);
    assert.match(lines[1].error.message, scenario.expected);
    assert.equal(lines.some((line) => line.method?.startsWith("agents.sessions.")), false);
    input.end();
    await worker.closed;
  }
});

test("model request RPCs use exact payloads and the declared operation-specific capabilities", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const connectionId = "22222222-2222-4222-8222-222222222222";
  const runId = "33333333-3333-4333-8333-333333333333";
  const calls = [
    { operation: "sps.models.list", capability: "sps.models.read", input: { companyId } },
    { operation: "sps.models.submit", capability: "sps.models.submit", input: { companyId, connectionId, requestKey: "worker:request-1", input: "Summarize this." } },
    { operation: "sps.models.get", capability: "sps.models.read", input: { companyId, runId } },
    { operation: "sps.models.cancel", capability: "sps.models.cancel", input: { companyId, runId } },
  ];
  let transport;
  const { input, lines, worker } = createHarness(defineSpsPlugin({
    initialize({ spsTransport }) { transport = spsTransport; },
    platform: defineSpsPlatformContract({
      capabilities: ["sps.models.read", "sps.models.submit", "sps.models.cancel"],
      actions: [{ key: "models", handler: async () => {
        const results = [];
        for (const call of calls) results.push(await transport.request(call.operation, call.input));
        return results;
      } }],
    }),
  }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-models", scope: { companyId } },
    params: { key: "models", companyId, params: {}, actorContext: { type: "user", companyId } },
  }) + "\n");
  for (let index = 0; index < calls.length; index += 1) {
    await eventually(() => lines.length === index + 2);
    assert.deepEqual(lines[index + 1], {
      jsonrpc: "2.0",
      id: `sps-${index + 1}`,
      method: calls[index].operation,
      params: calls[index].input,
      paperclipInvocationId: "inv-models",
    });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: `sps-${index + 1}`, result: index }) + "\n");
  }
  await eventually(() => lines.length === calls.length + 2);
  assert.deepEqual(lines.at(-1).result, [0, 1, 2, 3]);
  input.end();
  await worker.closed;
});

test("each model RPC requires its exact capability and matching invocation scope", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const foreignCompanyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const operations = [
    { operation: "sps.models.list", capability: "sps.models.read", input: { companyId } },
    { operation: "sps.models.submit", capability: "sps.models.submit", input: { companyId, connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "worker:request-1", input: "hello" } },
    { operation: "sps.models.get", capability: "sps.models.read", input: { companyId, runId: "33333333-3333-4333-8333-333333333333" } },
    { operation: "sps.models.cancel", capability: "sps.models.cancel", input: { companyId, runId: "33333333-3333-4333-8333-333333333333" } },
  ];
  for (const call of operations) {
    for (const scenario of ["capability", "missing_scope", "foreign_scope", "mismatched_context"]) {
      let transport;
      const capabilities = ["sps.models.read", "sps.models.submit", "sps.models.cancel"]
        .filter((capability) => scenario !== "capability" || capability !== call.capability);
      const { input, lines, worker } = createHarness(defineSpsPlugin({
        initialize({ spsTransport }) { transport = spsTransport; },
        platform: defineSpsPlatformContract({
          capabilities,
          actions: [{ key: "invoke", handler: () => transport.request(call.operation, call.input) }],
        }),
      }));
      input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
      await eventually(() => lines.length === 1);
      input.write(JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "performAction",
        ...(scenario === "missing_scope" ? {} : { paperclipInvocation: { id: `inv-${call.operation}-${scenario}`, scope: { companyId: scenario === "foreign_scope" ? foreignCompanyId : companyId } } }),
        params: {
          key: "invoke",
          companyId: scenario === "mismatched_context" ? foreignCompanyId : companyId,
          params: {},
          actorContext: { type: "user", companyId: scenario === "mismatched_context" ? foreignCompanyId : companyId },
        },
      }) + "\n");
      await eventually(() => lines.length === 2);
      assert.ok(lines[1].error, `${call.operation} ${scenario} should be denied`);
      assert.match(lines[1].error.message, scenario === "capability" ? /Undeclared.*sps\.models\./ : /authenticated invocation company/);
      assert.equal(lines.some((line) => line.method === call.operation), false);
      input.end();
      await worker.closed;
    }
  }
});

test("model requests cannot be issued during initialize or without an invocation context", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  let initializeError;
  let transport;
  const { input, lines, worker } = createHarness(defineSpsPlugin({
    async initialize(context) {
      transport = context.spsTransport;
      try {
        await transport.request("sps.models.list", { companyId });
      } catch (cause) {
        initializeError = cause;
      }
    },
    platform: defineSpsPlatformContract({ capabilities: ["sps.models.read"] }),
  }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  assert.match(initializeError.message, /authenticated invocation company/);
  await assert.rejects(transport.request("sps.models.list", { companyId }), /authenticated invocation company/);
  assert.equal(lines.some((line) => line.method === "sps.models.list"), false);
  input.end();
  await worker.closed;
});

test("model Worker rejects credential, endpoint, and accessor fields before Host RPC", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const connectionId = "22222222-2222-4222-8222-222222222222";
  let transport;
  const { input, lines, worker } = createHarness(defineSpsPlugin({
    initialize({ spsTransport }) { transport = spsTransport; },
    platform: defineSpsPlatformContract({
      capabilities: ["sps.models.submit"],
      actions: [{ key: "submit", handler: async () => {
        const invalid = { companyId, connectionId, requestKey: "worker:request-1", input: "hello", endpoint: "https://example.invalid", apiKey: "secret" };
        let extraFields;
        try { await transport.request("sps.models.submit", invalid); }
        catch (cause) { extraFields = cause.message; }
        let getterCalls = 0;
        const accessor = { companyId, connectionId, requestKey: "worker:request-1" };
        Object.defineProperty(accessor, "input", { enumerable: true, get() { getterCalls += 1; return "hello"; } });
        let accessorField;
        try { await transport.request("sps.models.submit", accessor); }
        catch (cause) { accessorField = cause.message; }
        return { extraFields, accessorField, getterCalls };
      } }],
    }),
  }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-model-submit", scope: { companyId } },
    params: { key: "submit", companyId, params: {}, actorContext: { type: "user", companyId } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.match(lines[1].result.extraFields, /only companyId, connectionId, requestKey, input/);
  assert.match(lines[1].result.accessorField, /own data property/);
  assert.equal(lines[1].result.getterCalls, 0);
  assert.equal(lines.some((line) => line.method === "sps.models.submit"), false);
  input.end();
  await worker.closed;
});

test("execution history RPCs are finite, forwarded with exact payloads, and invocation-company scoped", async () => {
  let transport;
  const page = { items: [], nextCursor: null };
  const { input, lines, worker } = createHarness(defineSpsPlugin({
    initialize({ spsTransport }) { transport = spsTransport; },
    platform: defineSpsPlatformContract({ actions: [{ key: "history", handler: async () => ({
      page: await transport.request("sps.executions.list", {
        companyId: "company-1",
        lane: "agent_session",
        limit: 10,
        before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" },
      }),
      execution: await transport.request("sps.executions.get", {
        companyId: "company-1", lane: "node", runId: "22222222-2222-4222-8222-222222222222",
      }),
      summary: await transport.request("sps.executions.summarize", {
        companyId: "company-1",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-08T00:00:00.000Z",
        lane: "agent_session",
        agentId: "33333333-3333-4333-8333-333333333333",
      }),
    }) }] }),
  }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-history", scope: { companyId: "company-1" } },
    params: { key: "history", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], {
    jsonrpc: "2.0", id: "sps-1", method: "sps.executions.list",
    params: {
      companyId: "company-1", lane: "agent_session", limit: 10,
      before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" },
    },
    paperclipInvocationId: "inv-history",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-1", result: page }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], {
    jsonrpc: "2.0", id: "sps-2", method: "sps.executions.get",
    params: { companyId: "company-1", lane: "node", runId: "22222222-2222-4222-8222-222222222222" },
    paperclipInvocationId: "inv-history",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-2", result: null }) + "\n");
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3], {
    jsonrpc: "2.0", id: "sps-3", method: "sps.executions.summarize",
    params: {
      companyId: "company-1",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-08T00:00:00.000Z",
      lane: "agent_session",
      agentId: "33333333-3333-4333-8333-333333333333",
    },
    paperclipInvocationId: "inv-history",
  });
  const summary = { executionCount: 0, tokens: {}, costs: {}, duration: {} };
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-3", result: summary }) + "\n");
  await eventually(() => lines.length === 5);
  assert.deepEqual(lines[4].result, { page, execution: null, summary });
  input.end();
  await worker.closed;
});

test("execution history rejects missing, malformed, and cross-company invocation scope before Host RPC", async () => {
  const cases = [
    { scope: {}, companyId: "company-1" },
    { scope: { companyId: 7 }, companyId: "company-1" },
    { scope: { companyId: "company-1" }, companyId: "company-2" },
    { scope: { companyId: "company-1" }, companyId: "company-2", operation: "sps.executions.summarize" },
  ];
  for (const [index, scenario] of cases.entries()) {
    let transport;
    const { input, lines, worker } = createHarness(defineSpsPlugin({
      initialize({ spsTransport }) { transport = spsTransport; },
      platform: defineSpsPlatformContract({ actions: [{ key: "history", handler: () => scenario.operation === "sps.executions.summarize"
        ? transport.request(scenario.operation, { companyId: scenario.companyId, from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" })
        : transport.request("sps.executions.get", { companyId: scenario.companyId, lane: "node", runId: "22222222-2222-4222-8222-222222222222" }) }] }),
    }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "performAction",
      paperclipInvocation: { id: `inv-history-${index}`, scope: scenario.scope },
      params: { key: "history", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
    }) + "\n");
    await eventually(() => lines.length === 2);
    assert.match(lines[1].error.message, /authenticated invocation company/);
    assert.equal(lines.some((line) => line.method === "sps.executions.get" || line.method === "sps.executions.summarize"), false);
    input.end();
    await worker.closed;
  }
});

test("Agent cancellation acknowledgement does not terminate or clear the session callback", async () => {
  const events = [];
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.send", "agent.sessions.cancel"],
    actions: [{ key: "cancel", handler: async (_params, context) => {
      const sent = await context.agents.sessions.sendMessage("session-1", "company-1", { prompt: "hello", onEvent: (event) => events.push(event.eventType) });
      const result = await context.agents.sessions.cancel("session-1", "company-1", sent.runId);
      return { sent, result };
    } }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-cancel", scope: { companyId: "company-1" } },
    params: { key: "cancel", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.equal(lines[1].method, "agents.sessions.sendMessage");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, result: { runId: "run-1" } }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], {
    jsonrpc: "2.0", id: "sps-2", method: "agents.sessions.cancel",
    params: { sessionId: "session-1", companyId: "company-1", runId: "run-1" },
    paperclipInvocationId: "inv-cancel",
  });
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: "sps-2",
    result: { runId: "run-1", status: "cancelled", cancellationRequested: true, termination: "confirmed", errorCode: null, error: null },
  }) + "\n");
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3].result.result, { runId: "run-1", status: "cancelled", cancellationRequested: true, termination: "confirmed", errorCode: null, error: null });
  assert.deepEqual(events, []);

  for (const eventType of ["status", "done", "done"]) {
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "agents.sessions.event", params: { sessionId: "session-1", eventType } }) + "\n");
  }
  await eventually(() => events.length === 2);
  assert.deepEqual(events, ["status", "done"]);
  input.end();
  await worker.closed;
});

test("Agent access without a declared capability never calls the Host", async()=>{
  const {input,lines,worker}=createHarness(defineSpsPlugin({platform:defineSpsPlatformContract({actions:[{key:"agents",handler:(_params,context)=>context.agents.list({companyId:"a"})}]})}));
  input.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{}})+"\n");await eventually(()=>lines.length===1);
  input.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"performAction",params:{key:"agents",companyId:"a",params:{},actorContext:{type:"user",companyId:"a"}}})+"\n");
  await eventually(()=>lines.length===2);assert.match(lines[1].error.message,/Undeclared/);
  assert.equal(lines.some(line=>line.method==="agents.list"),false);
  input.end();await worker.closed;
});

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
      const runs = await spsTransport.request("sps.runs.list", { companyId: "company-1", status: "running" });
      const cancelled = await spsTransport.request("sps.runs.cancel", { companyId: "company-1", runId: "run-1" });
      return { initialized: Array.isArray(runtimes) && Array.isArray(runs), cancelled: cancelled.status === "cancelling" };
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
  assert.deepEqual(lines[1], { jsonrpc: "2.0", id: "sps-2", method: "sps.runs.list", params: { companyId: "company-1", status: "running" } });
  input.write('{"jsonrpc":"2.0","id":"sps-2","result":[]}\n');
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], { jsonrpc: "2.0", id: "sps-3", method: "sps.runs.cancel", params: { companyId: "company-1", runId: "run-1" } });
  input.write('{"jsonrpc":"2.0","id":"sps-3","result":{"status":"cancelling"}}\n');
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3], { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: ["health", "shutdown"] } });
  input.write('{"jsonrpc":"2.0","id":2,"method":"health"}\n');
  await eventually(() => lines.length === 5);
  assert.deepEqual(lines[4], { jsonrpc: "2.0", id: 2, result: { status: "ok" } });
  input.write('{"jsonrpc":"2.0","id":3,"method":"shutdown"}\n');
  await eventually(() => lines.length === 6);
  assert.deepEqual(lines[5], { jsonrpc: "2.0", id: 3, result: { stopped: true } });
  await worker.closed;
});

test("Worker rejects unsupported Runtime operations before protocol output and reports malformed input as JSON-RPC errors", async () => {
  const plugin = defineSpsPlugin({
    async initialize({ spsTransport }) {
      await assert.rejects(spsTransport.request("companies.list", {}), /Unsupported SPS Runtime operation/);
      await assert.rejects(spsTransport.request("agents.sessions.getRun", { sessionId: "s", companyId: "c", runId: "r" }), /Unsupported SPS Runtime operation/);
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
