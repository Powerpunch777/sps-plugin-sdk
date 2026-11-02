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

test("Agent session request identity is forwarded and request lookup is read-scoped", async () => {
  const requestId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const submitted = { requestId: requestId.toLowerCase(), state: "submitted", runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.send", "agent.sessions.read"],
    actions: [{ key: "requests", handler: async (_params, context) => ({
      legacy: await context.agents.sessions.sendMessage("session-1", "company-1", { prompt: "legacy prompt" }),
      retried: await context.agents.sessions.sendMessage("session-1", "company-1", {
        prompt: "retry prompt", reason: "retry after reconnect", requestId,
      }),
      found: await context.agents.sessions.getRequest("session-1", "company-1", requestId),
      missing: await context.agents.sessions.getRequest("session-1", "company-1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    }) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-requests", scope: { companyId: "company-1" } },
    params: { key: "requests", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");

  const expected = [
    { method: "agents.sessions.sendMessage", params: { sessionId: "session-1", companyId: "company-1", prompt: "legacy prompt" } },
    { method: "agents.sessions.sendMessage", params: { sessionId: "session-1", companyId: "company-1", prompt: "retry prompt", reason: "retry after reconnect", requestId: requestId.toLowerCase() } },
    { method: "agents.sessions.getRequest", params: { sessionId: "session-1", companyId: "company-1", requestId: requestId.toLowerCase() } },
    { method: "agents.sessions.getRequest", params: { sessionId: "session-1", companyId: "company-1", requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
  ];
  const responses = [{ runId: "run-legacy" }, { runId: "run-retry" }, submitted, null];
  for (let index = 0; index < expected.length; index += 1) {
    await eventually(() => lines.length === index + 2);
    assert.deepEqual(lines[index + 1], {
      jsonrpc: "2.0", id: `sps-${index + 1}`, ...expected[index], paperclipInvocationId: "inv-requests",
    });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: `sps-${index + 1}`, result: responses[index] }) + "\n");
  }
  await eventually(() => lines.length === 6);
  assert.deepEqual(lines[5], {
    jsonrpc: "2.0", id: 2,
    result: {
      legacy: { runId: "run-legacy" },
      retried: { runId: "run-retry" },
      found: submitted,
      missing: null,
    },
  });
  input.end();
  await worker.closed;
});

test("Agent session execution policy is snapshotted, validated, and forwarded", async () => {
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const executionPolicy = { mode: "plugin-tools-only-v1", toolNames: ["summarize", "search"] };
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.send"],
    actions: [{ key: "send", handler: async (_params, context) => {
      const sent = context.agents.sessions.sendMessage("session-1", "company-1", { prompt: "hello", requestId, executionPolicy });
      executionPolicy.toolNames[0] = "mutated";
      return sent;
    } }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-policy-send", scope: { companyId: "company-1" } },
    params: { key: "send", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1].params, {
    sessionId: "session-1", companyId: "company-1", prompt: "hello",
    requestId,
    executionPolicy: { mode: "plugin-tools-only-v1", toolNames: ["search", "summarize"] },
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, result: { runId: "run-1" } }) + "\n");
  await eventually(() => lines.length === 3);
  input.end();
  await worker.closed;
});

test("Malformed Agent session execution policies are rejected before Host calls", async () => {
  const policies = [
    { mode: "unrestricted", toolNames: ["search"] },
    { mode: "plugin-tools-only-v1", toolNames: [] },
    { mode: "plugin-tools-only-v1", toolNames: ["search", "search"] },
    { mode: "plugin-tools-only-v1", toolNames: ["search", "search.docs"] },
    { mode: "plugin-tools-only-v1", toolNames: ["search.docs", "search"] },
    { mode: "plugin-tools-only-v1", toolNames: ["plugin:search"] },
    { mode: "plugin-tools-only-v1", toolNames: ["search".repeat(129)] },
    { mode: "plugin-tools-only-v1", toolNames: Array.from({ length: 33 }, (_, index) => `tool${String(index).padStart(2, "0")}`) },
    { mode: "plugin-tools-only-v1", toolNames: [""] },
    { mode: "plugin-tools-only-v1", toolNames: ["search"], extra: true },
    { mode: "plugin-tools-only-v1", toolNames: new Array(1) },
  ];
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.send"],
    actions: [{ key: "invalid", handler: async (_params, context) => {
      const errors = [];
      for (const executionPolicy of policies) {
        try { await context.agents.sessions.sendMessage("session-1", "company-1", { prompt: "hello", executionPolicy }); }
        catch (cause) { errors.push(cause.message); }
      }
      try {
        await context.agents.sessions.sendMessage("session-1", "company-1", {
          prompt: "hello", executionPolicy: { mode: "plugin-tools-only-v1", toolNames: ["search"] },
        });
      } catch (cause) { errors.push(cause.message); }
      return errors;
    } }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-policy-invalid", scope: { companyId: "company-1" } },
    params: { key: "invalid", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.equal(lines[1].result.length, policies.length + 1);
  assert.match(lines[1].result.at(-1), /durable requestId/);
  assert.equal(lines[1].method, undefined);
  assert.equal(lines[1].result.slice(0, -1).every((message) => /executionPolicy/.test(message)), true);
  assert.equal(lines.some((line) => line.method === "agents.sessions.sendMessage"), false);
  input.end();
  await worker.closed;
});

test("Agent session policy support is read-scoped, validated, and has no old-Host fallback", async () => {
  const support = {
    schemaVersion: 1,
    modes: ["plugin-tools-only-v1"],
    enforcement: "dispatch-and-run",
    readiness: "unknown",
    osIsolation: "not-certified",
  };
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.read"],
    actions: [{ key: "support", handler: (_params, context) => context.agents.sessions.describePolicySupport("session-1", "company-1") }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-policy-support", scope: { companyId: "company-1" } },
    params: { key: "support", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], {
    jsonrpc: "2.0", id: "sps-1", method: "agents.sessions.describePolicySupport",
    params: { sessionId: "session-1", companyId: "company-1" }, paperclipInvocationId: "inv-policy-support",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, result: support }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2].result, support);

  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 3, method: "performAction",
    paperclipInvocation: { id: "inv-policy-unsupported", scope: { companyId: "company-1" } },
    params: { key: "support", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 4);
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[3].id, result: { ...support, modes: [] } }) + "\n");
  await eventually(() => lines.length === 5);
  assert.deepEqual(lines[4].result, { ...support, modes: [] });

  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 4, method: "performAction",
    paperclipInvocation: { id: "inv-policy-old-host", scope: { companyId: "company-1" } },
    params: { key: "support", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 6);
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[5].id, error: { message: "Unsupported operation" } }) + "\n");
  await eventually(() => lines.length === 7);
  assert.equal(lines[6].error.message, "Unsupported operation");
  assert.equal(lines.slice(1).filter((line) => line.method === "agents.sessions.sendMessage").length, 0);
  input.end();
  await worker.closed;
});

test("Agent session request lookup requires read capability and the invocation company", async () => {
  const scenarios = [
    { capabilities: ["agent.sessions.send"], companyId: "company-1", expected: /Undeclared.*agent\.sessions\.read/ },
    { capabilities: ["agent.sessions.read"], companyId: "company-2", expected: /authenticated invocation company/ },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
      capabilities: scenario.capabilities,
      actions: [{ key: "lookup", handler: (_params, context) => context.agents.sessions.getRequest(
        "session-1", scenario.companyId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ) }],
    }) }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "performAction",
      paperclipInvocation: { id: `inv-request-scope-${index}`, scope: { companyId: "company-1" } },
      params: { key: "lookup", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
    }) + "\n");
    await eventually(() => lines.length === 2);
    assert.match(lines[1].error.message, scenario.expected);
    assert.equal(lines.some(line => line.method === "agents.sessions.getRequest"), false);
    input.end();
    await worker.closed;
  }
});

test("Agent session request IDs and send options are validated before Host calls", async () => {
  const invalidRequestIds = ["", "not-a-uuid", null, 7];
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.send", "agent.sessions.read"],
    actions: [{ key: "invalid", handler: async (_params, context) => {
      const errors = [];
      for (const requestId of invalidRequestIds) {
        try {
          await context.agents.sessions.sendMessage("session-1", "company-1", { prompt: "hello", requestId });
        } catch (cause) { errors.push(cause.message); }
        try {
          await context.agents.sessions.getRequest("session-1", "company-1", requestId);
        } catch (cause) { errors.push(cause.message); }
      }
      try {
        await context.agents.sessions.sendMessage("session-1", "company-1", { prompt: "hello", unsupported: true });
      } catch (cause) { errors.push(cause.message); }
      return errors;
    } }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-invalid-request-id", scope: { companyId: "company-1" } },
    params: { key: "invalid", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.equal(lines[1].method, undefined);
  assert.equal(lines[1].result.length, 9);
  assert.equal(lines[1].result.filter(message => /canonical UUID/.test(message)).length, 4);
  assert.match(lines[1].result[8], /only prompt, reason, requestId, executionPolicy, onEvent/);
  assert.equal(lines.some(line => line.method?.startsWith("agents.sessions.")), false);
  input.end();
  await worker.closed;
});

test("Agent session request lookup validates exact response fields and fails closed on older Hosts", async () => {
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const [index, result] of [
    { requestId, state: "unknown", runId: null },
    { requestId, state: "pending", runId: null, extra: true },
    { requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", state: "uncertain", runId: null },
    { requestId, state: "pending", runId: {} },
    { requestId, state: "submitted", runId: null },
    { requestId, state: "uncertain", runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  ].entries()) {
    const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
      capabilities: ["agent.sessions.read"],
      actions: [{ key: "lookup", handler: (_params, context) => context.agents.sessions.getRequest("session-1", "company-1", requestId) }],
    }) }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "performAction",
      paperclipInvocation: { id: `inv-request-result-${index}`, scope: { companyId: "company-1" } },
      params: { key: "lookup", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
    }) + "\n");
    await eventually(() => lines.length === 2);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, result }) + "\n");
    await eventually(() => lines.length === 3);
    assert.match(lines[2].error.message, /agent session request result/);
    input.end();
    await worker.closed;
  }

  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.read"],
    actions: [{ key: "lookup", handler: (_params, context) => context.agents.sessions.getRequest("session-1", "company-1", requestId) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-old-request-host", scope: { companyId: "company-1" } },
    params: { key: "lookup", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.equal(lines[1].method, "agents.sessions.getRequest");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, error: { code: -32601, message: "Method not found" } }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2].error, { code: -32601, message: "Method not found" });
  assert.deepEqual(lines.filter(line => line.method?.startsWith("agents.sessions.")).map(line => line.method), ["agents.sessions.getRequest"]);
  input.end();
  await worker.closed;
});

test("Agent session ensure uses the create capability and sends only the explicit ensure RPC", async () => {
  const recovered = { sessionId: "77777777-7777-4777-8777-777777777777", created: false };
  const created = { sessionId: "session-new", created: true };
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.create"],
    actions: [{ key: "ensure", handler: async (_params, context) => ({
      recovered: await context.agents.sessions.ensure("agent-1", "company-1", { taskKey: "plugin:demo:session:main", expectedSessionId: recovered.sessionId }),
      created: await context.agents.sessions.ensure("agent-1", "company-1", { taskKey: "plugin:demo:session:later" }),
    }) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-ensure", scope: { companyId: "company-1" } },
    params: { key: "ensure", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], {
    jsonrpc: "2.0", id: "sps-1", method: "agents.sessions.ensure",
    params: { agentId: "agent-1", companyId: "company-1", taskKey: "plugin:demo:session:main", expectedSessionId: recovered.sessionId },
    paperclipInvocationId: "inv-ensure",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-1", result: recovered }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2], {
    jsonrpc: "2.0", id: "sps-2", method: "agents.sessions.ensure",
    params: { agentId: "agent-1", companyId: "company-1", taskKey: "plugin:demo:session:later" },
    paperclipInvocationId: "inv-ensure",
  });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-2", result: created }) + "\n");
  await eventually(() => lines.length === 4);
  assert.deepEqual(lines[3], { jsonrpc: "2.0", id: 2, result: { recovered, created } });
  assert.equal(lines.some(line => line.method === "agents.sessions.create" || line.method === "agents.sessions.list"), false);
  input.end();
  await worker.closed;
});

test("Agent session ensure fails closed when the Host does not support the RPC", async () => {
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    capabilities: ["agent.sessions.create"],
    actions: [{ key: "ensure", handler: (_params, context) => context.agents.sessions.ensure("agent-1", "company-1", { taskKey: "plugin:demo:session:main" }) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    params: { key: "ensure", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.equal(lines[1].method, "agents.sessions.ensure");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, error: { code: -32601, message: "Method not found" } }) + "\n");
  await eventually(() => lines.length === 3);
  assert.deepEqual(lines[2].error, { code: -32601, message: "Method not found" });
  assert.deepEqual(lines.filter(line => line.method?.startsWith("agents.sessions.")).map(line => line.method), ["agents.sessions.ensure"]);
  input.end();
  await worker.closed;
});

test("Agent session ensure is denied without the reused create capability", async () => {
  const { input, lines, worker } = createHarness(defineSpsPlugin({ platform: defineSpsPlatformContract({
    actions: [{ key: "ensure", handler: (_params, context) => context.agents.sessions.ensure("agent-1", "company-1", { taskKey: "plugin:demo:session:main" }) }],
  }) }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "performAction",
    params: { key: "ensure", companyId: "company-1", params: {}, actorContext: { type: "user", companyId: "company-1" } },
  }) + "\n");
  await eventually(() => lines.length === 2);
  assert.match(lines[1].error.message, /Undeclared.*agent\.sessions\.create/);
  assert.equal(lines.some(line => line.method?.startsWith("agents.sessions.")), false);
  input.end();
  await worker.closed;
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

test("Native connectivity RPC requires its read capability and an authenticated invocation, then forwards no target input", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  let transport;
  const { input, lines, worker } = createHarness(defineSpsPlugin({
    initialize({ spsTransport }) { transport = spsTransport; },
    platform: defineSpsPlatformContract({
      capabilities: ["sps.connectivity.read"],
      actions: [{ key: "connectivity", handler: () => transport.request("sps.connectivity.current", {}) }],
    }),
  }));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  await eventually(() => lines.length === 1);
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "performAction",
    paperclipInvocation: { id: "inv-connectivity", scope: { companyId } },
    params: { key: "connectivity", companyId, params: {}, actorContext: { type: "user", companyId } } }) + "\n");
  await eventually(() => lines.length === 2);
  assert.deepEqual(lines[1], { jsonrpc: "2.0", id: "sps-1", method: "sps.connectivity.current",
    params: {}, paperclipInvocationId: "inv-connectivity" });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "sps-1", result: { state: "unavailable" } }) + "\n");
  await eventually(() => lines.length === 3);
  assert.equal(lines[2].result.state, "unavailable");
  input.end();
  await worker.closed;
});

test("Native connectivity RPC rejects missing capability, invocation, and caller-supplied target fields", async () => {
  for (const scenario of ["capability", "invocation", "target"]) {
    let transport;
    let denied;
    const companyId = "11111111-1111-4111-8111-111111111111";
    const capabilities = scenario === "capability" ? [] : ["sps.connectivity.read"];
    const { input, lines, worker } = createHarness(defineSpsPlugin({
      initialize({ spsTransport }) { transport = spsTransport; },
      platform: defineSpsPlatformContract({ capabilities, actions: [{ key: "invoke", handler: async () => {
        try {
          return await transport.request("sps.connectivity.current", scenario === "target" ? { hostId: companyId } : {});
        } catch (cause) { denied = cause.message; return "denied"; }
      } }] }),
    }));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "performAction",
      ...(scenario === "invocation" ? {} : { paperclipInvocation: { id: `inv-${scenario}`, scope: { companyId } } }),
      params: { key: "invoke", companyId, params: {}, actorContext: { type: "user", companyId } } }) + "\n");
    await eventually(() => lines.length === 2);
    assert.equal(lines[1].result, "denied");
    assert.match(denied, scenario === "capability" ? /Undeclared.*sps\.connectivity\.read/ : /connectivity current input|authenticated invocation company/);
    assert.equal(lines.some((line) => line.method === "sps.connectivity.current"), false);
    input.end();
    await worker.closed;
  }
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

test("state.compareAndSet forwards bounded company-scoped JSON once and enforces its result and capabilities", async () => {
  const companyId = "11111111-aaaa-4111-8111-111111111111";
  const key = { scopeKind: "company", scopeId: companyId, namespace: "settings", stateKey: "nullable" };

  async function invoke({ key: requestKey = key, expected, value, capabilities = ["plugin.state.read", "plugin.state.write"], response, hostError, responseLoss } = {}) {
    const platform = defineSpsPlatformContract({
      capabilities,
      tools: [{ name: "cas", declaration: { displayName: "CAS", description: "CAS", parametersSchema: {} },
        handler: (_params, _context, api) => api.state.compareAndSet(requestKey, expected, value) }],
    });
    const { input, lines, logs, worker } = createHarness(defineSpsPlugin({ platform }));
    input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    await eventually(() => lines.length === 1);
    input.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "executeTool",
      paperclipInvocation: { id: "invocation-1", scope: { companyId } },
      params: { toolName: "cas", parameters: {}, runContext: { companyId } },
    }) + "\n");
    await eventually(() => lines.length >= 2);
    if (lines[1].method === "state.compareAndSet") {
      if (responseLoss) {
        input.end();
        await worker.closed;
        await eventually(() => logs.length > 0);
        return { lines, logs };
      }
      if (hostError) input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, error: hostError }) + "\n");
      else input.write(JSON.stringify({ jsonrpc: "2.0", id: lines[1].id, result: response }) + "\n");
      await eventually(() => lines.length === 3);
    }
    input.end();
    await worker.closed;
    return { lines, logs };
  }

  for (const swapped of [true, false]) {
    const { lines } = await invoke({ expected: { exists: false }, value: null, response: { swapped } });
    assert.equal(lines[1].method, "state.compareAndSet", JSON.stringify(lines));
    assert.deepEqual(lines[1].params, { ...key, expected: { exists: false }, value: null });
    assert.deepEqual(lines[2].result, { swapped });
  }
  const { lines: existingNull } = await invoke({ expected: { exists: true, value: null }, value: { next: null }, response: { swapped: true } });
  assert.deepEqual(existingNull[1].params.expected, { exists: true, value: null });
  assert.deepEqual(existingNull[1].params.value, { next: null });

  for (const expected of [
    { exists: false, value: null },
    { exists: true },
    { exists: true, value: null, extra: true },
  ]) {
    const { lines } = await invoke({ expected, value: null });
    assert.equal(lines.length, 2);
    assert.ok(lines[1].error);
  }
  const { lines: unknownKeyField } = await invoke({ key: { ...key, unexpected: true }, expected: { exists: false }, value: null });
  assert.equal(unknownKeyField.length, 2);
  assert.ok(unknownKeyField[1].error);
  const getterExpected = Object.defineProperty({}, "exists", { enumerable: true, get() { throw new Error("must not run"); } });
  const { lines: accessorInput } = await invoke({ expected: getterExpected, value: null });
  assert.equal(accessorInput.length, 2);
  assert.ok(accessorInput[1].error);
  const getterKey = Object.defineProperty({ scopeKind: "company", namespace: "settings", stateKey: "nullable" }, "scopeId", {
    enumerable: true, get() { throw new Error("must not run"); },
  });
  const { lines: accessorKey } = await invoke({ key: getterKey, expected: { exists: false }, value: null });
  assert.equal(accessorKey.length, 2);
  assert.ok(accessorKey[1].error);
  const { lines: uppercaseUuid } = await invoke({ key: { ...key, scopeId: companyId.toUpperCase() }, expected: { exists: false }, value: null, response: { swapped: true } });
  assert.equal(uppercaseUuid.length, 2);
  assert.match(uppercaseUuid[1].error.message, /lowercase canonical UUID/);
  const { lines: tooLongKey } = await invoke({ key: { ...key, stateKey: "x".repeat(257) }, expected: { exists: false }, value: null });
  assert.equal(tooLongKey.length, 2);
  assert.match(tooLongKey[1].error.message, /at most 256 characters/);
  const { lines: whitespaceKey } = await invoke({ key: { ...key, namespace: " \t " }, expected: { exists: false }, value: null });
  assert.equal(whitespaceKey.length, 2);
  assert.match(whitespaceKey[1].error.message, /must not be empty or whitespace/);
  let deeplyNested = null;
  for (let index = 0; index < 65; index += 1) deeplyNested = { child: deeplyNested };
  const { lines: deepValue } = await invoke({ expected: { exists: false }, value: deeplyNested });
  assert.equal(deepValue.length, 2);
  assert.match(deepValue[1].error.message, /depth limit of 64/);
  const { lines: tooManyNodes } = await invoke({ expected: { exists: true, value: new Array(25_000).fill(null) }, value: new Array(25_000).fill(null) });
  assert.equal(tooManyNodes.length, 2);
  assert.match(tooManyNodes[1].error.message, /node limit of 50000/);
  const { lines: oversized } = await invoke({ expected: { exists: false }, value: "x".repeat(262_144) });
  assert.equal(oversized.length, 2);
  assert.match(oversized[1].error.message, /262144 UTF-8 bytes/);
  for (const capabilities of [["plugin.state.read"], ["plugin.state.write"]]) {
    const { lines } = await invoke({ expected: { exists: false }, value: null, capabilities });
    assert.equal(lines.length, 2);
    assert.match(lines[1].error.message, /Undeclared SPS Platform capability/);
  }
  for (const response of [{ swapped: 1 }, { swapped: true, extra: false }, null]) {
    const { lines } = await invoke({ expected: { exists: false }, value: null, response });
    assert.equal(lines.length, 3);
    assert.ok(lines[2].error);
  }
  const { lines: rejectedHostCall } = await invoke({
    expected: { exists: false }, value: null,
    hostError: { code: -32601, message: "Unknown Host method" },
  });
  assert.equal(rejectedHostCall.filter((line) => line.method === "state.compareAndSet").length, 1);
  assert.equal(rejectedHostCall.length, 3);
  assert.equal(rejectedHostCall[2].error.message, "Unknown Host method");
  const lostResponse = await invoke({ expected: { exists: false }, value: null, responseLoss: true });
  assert.equal(lostResponse.lines.filter((line) => line.method === "state.compareAndSet").length, 1);
  assert.ok(lostResponse.logs.some((message) => /transport is closed/.test(message)));
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
