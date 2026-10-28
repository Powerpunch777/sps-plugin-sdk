import assert from "node:assert/strict";
import test from "node:test";
import { SPS_RUNTIME_OPERATIONS, createSpsRuntimeClient, defineSpsRuntimeContract } from "./index.mjs";

test("runtime facade uses the exact existing Host RPC names and payloads", async () => {
  const calls = [];
  const client = createSpsRuntimeClient({ async request(operation, input) { calls.push({ operation, input }); return []; } });

  await client.executions.list("company-1", {
    lane: "agent_session",
    limit: 25,
    before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" },
  });
  await client.executions.get("company-1", "node", "22222222-2222-4222-8222-222222222222");
  await client.executions.summarize("11111111-1111-4111-8111-111111111111", {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-08T00:00:00.000Z",
    lane: "agent_session",
    agentId: "22222222-2222-4222-8222-222222222222",
  });
  await client.models.list("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA");
  await client.models.submit({
    companyId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    connectionId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    requestKey: "job:build-42",
    input: "Summarize this build.",
  });
  await client.models.get("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC");
  await client.models.cancel("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC");
  await client.workspaceSources.list("company-1");
  await client.runtimes.list("company-1", { nodeId: null, command: "ignored" });
  await client.executionGrants.list("company-1", { subjectKey: null, includeRevoked: false, path: "ignored" });
  await client.executionGrants.upsert({ companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: "profile-1", workspaceSourceId: null, command: "ignored" });
  await client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: ["--safe"], env: { MODE: "test" }, stdin: null, timeoutMs: 3000, workingDirectory: "ignored" });
  await client.runs.list("company-1", { subjectKey: null, status: "running", limit: 200, beforeId: "run-cursor", extra: "ignored" });
  await client.runs.listEvents("company-1", "run-1", { afterSequence: null, rawCommand: "ignored" });
  await client.runs.cancel("company-1", "run-1");
  await client.artifacts.publish({ companyId: "company-1", subjectKey: "subject-1", runId: null, title: "Build", kind: null, referenceUrl: null, summary: null, data: { ok: true }, path: "ignored" });
  await client.artifacts.list("company-1", { subjectKey: null, runId: null, limit: null, cwd: "ignored" });

  assert.deepEqual(calls, [
    { operation: "sps.executions.list", input: { companyId: "company-1", lane: "agent_session", limit: 25, before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" } } },
    { operation: "sps.executions.get", input: { companyId: "company-1", lane: "node", runId: "22222222-2222-4222-8222-222222222222" } },
    { operation: "sps.executions.summarize", input: { companyId: "11111111-1111-4111-8111-111111111111", from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", lane: "agent_session", agentId: "22222222-2222-4222-8222-222222222222" } },
    { operation: "sps.models.list", input: { companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    { operation: "sps.models.submit", input: { companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", connectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestKey: "job:build-42", input: "Summarize this build." } },
    { operation: "sps.models.get", input: { companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } },
    { operation: "sps.models.cancel", input: { companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } },
    { operation: "sps.workspaceSources.list", input: { companyId: "company-1" } },
    { operation: "sps.runtimes.list", input: { companyId: "company-1", nodeId: null } },
    { operation: "sps.executionGrants.list", input: { companyId: "company-1", subjectKey: null, includeRevoked: false } },
    { operation: "sps.executionGrants.upsert", input: { companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: "profile-1", workspaceSourceId: null } },
    { operation: "sps.runs.dispatch", input: { companyId: "company-1", executionGrantId: "grant-1", args: ["--safe"], env: { MODE: "test" }, stdin: null, timeoutMs: 3000 } },
    { operation: "sps.runs.list", input: { companyId: "company-1", subjectKey: null, status: "running", limit: 200, beforeId: "run-cursor" } },
    { operation: "sps.runs.listEvents", input: { companyId: "company-1", runId: "run-1", afterSequence: null } },
    { operation: "sps.runs.cancel", input: { companyId: "company-1", runId: "run-1" } },
    { operation: "sps.artifacts.publish", input: { companyId: "company-1", subjectKey: "subject-1", runId: null, title: "Build", kind: null, referenceUrl: null, summary: null, data: { ok: true } } },
    { operation: "sps.artifacts.list", input: { companyId: "company-1", subjectKey: null, runId: null, limit: null } },
  ]);
  assert.deepEqual(SPS_RUNTIME_OPERATIONS, [
    "sps.executions.list", "sps.executions.get", "sps.executions.summarize",
    "sps.connectivity.current",
    "sps.models.list", "sps.models.submit", "sps.models.get", "sps.models.cancel",
    "sps.workspaceSources.list", "sps.runtimes.list", "sps.executionGrants.list", "sps.executionGrants.upsert", "sps.executionGrants.revoke",
    "sps.runs.dispatch", "sps.runs.get", "sps.runs.list", "sps.runs.listEvents", "sps.runs.cancel", "sps.artifacts.publish", "sps.artifacts.list",
  ]);
});

test("Native connectivity facade sends an empty request and validates scoped snapshots", async () => {
  const calls = [];
  const snapshot = { state: "verified", transport: "native_tls", hostId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222", authorization: "authorized",
    evidence: "authenticated_request", observedAt: "2026-10-27T10:20:30.000Z" };
  const client = createSpsRuntimeClient({ async request(operation, input) { calls.push({ operation, input }); return snapshot; } });
  assert.deepEqual(await client.connectivity.current(), snapshot);
  assert.deepEqual(calls, [{ operation: "sps.connectivity.current", input: {} }]);
  assert.ok(Object.isFrozen(await client.connectivity.current()));
  assert.throws(() => client.connectivity.current(undefined), /does not accept arguments/);
  assert.throws(() => client.connectivity.current({}), /does not accept arguments/);
});

test("Native connectivity facade accepts unavailable snapshots and rejects unsafe or malformed DTOs", async () => {
  const unavailable = { state: "unavailable", transport: "native_tls", hostId: null,
    workspaceId: "22222222-2222-4222-8222-222222222222", authorization: "unknown", evidence: "none",
    observedAt: "2026-10-27T10:20:30.000Z" };
  const clientFor = value => createSpsRuntimeClient({ async request() { return value; } });
  assert.deepEqual(await clientFor(unavailable).connectivity.current(), unavailable);
  const invalid = [
    { ...unavailable, address: "https://private.example" },
    { ...unavailable, workspaceId: "not-a-uuid" },
    { ...unavailable, observedAt: "2026-02-30T10:20:30.000Z" },
    { ...unavailable, observedAt: "2026-99-99T10:20:30.000Z" },
    { ...unavailable, evidence: "authenticated_request" },
    { ...unavailable, state: "verified" },
    Object.defineProperty({ ...unavailable }, "hostId", { enumerable: true, get() { throw new Error("must not run"); } }),
  ];
  for (const value of invalid) await assert.rejects(clientFor(value).connectivity.current(), TypeError);
});

test("malformed declared fields fail before transport while raw fields are omitted", () => {
  let transportCalls = 0;
  const client = createSpsRuntimeClient({ request() { transportCalls += 1; } });

  assert.throws(() => client.executions.list("company-1", { lane: "other" }), /lane/);
  assert.throws(() => client.executions.list("company-1", { limit: 0 }), /limit/);
  assert.throws(() => client.executions.list("company-1", { limit: 101 }), /integer from 1 through 100/);
  assert.throws(() => client.executions.list("company-1", { limit: null }), /integer from 1 through 100/);
  assert.throws(() => client.executions.list("company-1", { limit: 1.5 }), /limit/);
  assert.throws(() => client.executions.list("company-1", { before: { createdAt: "2026-10-22T12:34:56Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" } }), /canonical ISO timestamp/);
  assert.throws(() => client.executions.list("company-1", { before: { createdAt: "2026-02-30T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" } }), /canonical ISO timestamp/);
  assert.throws(() => client.executions.list("company-1", { before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "not-a-uuid", lane: "node" } }), /UUID/);
  assert.throws(() => client.executions.list("company-1", { before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "unknown" } }), /lane/);
  assert.throws(() => client.executions.list("company-1", { before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node", extra: true } }), /only createdAt, runId, and lane/);
  assert.throws(() => client.executions.get("company-1", "agent", "11111111-1111-4111-8111-111111111111"), /lane/);
  assert.throws(() => client.executions.get("company-1", "agent_session", "run-1"), /UUID/);
  const summaryOptions = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" };
  assert.throws(() => client.executions.summarize("company-1", summaryOptions), /companyId.*UUID/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, from: "2026-10-01T00:00:00Z" }), /canonical ISO timestamp/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, from: "2026-02-30T00:00:00.000Z" }), /canonical ISO timestamp/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, to: summaryOptions.from }), /later than from/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.001Z" }), /no more than 31 days/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, lane: "other" }), /lane/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, agentId: "not-a-uuid" }), /agentId.*UUID/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, lane: "node", agentId: "22222222-2222-4222-8222-222222222222" }), /cannot be combined/);
  assert.throws(() => client.executions.summarize("11111111-1111-4111-8111-111111111111", { ...summaryOptions, pluginKey: "ignored" }), /only from, to, lane, and agentId/);
  assert.throws(() => client.runtimes.list("company-1", { nodeId: 42 }), /nodeId must be a string/);
  assert.throws(() => client.executionGrants.list("company-1", { includeRevoked: "yes" }), /includeRevoked/);
  assert.throws(() => client.models.list("company-1"), /companyId.*UUID/);
  assert.throws(() => client.models.list("11111111-1111-4111-8111-111111111111\n"), /companyId.*UUID/);
  assert.throws(() => client.models.submit({ companyId: "company-1", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "ok", input: "hello" }), /companyId.*UUID/);
  assert.throws(() => client.models.submit({ companyId: "11111111-1111-4111-8111-111111111111", connectionId: "connection", requestKey: "ok", input: "hello" }), /connectionId.*UUID/);
  assert.throws(() => client.models.get("11111111-1111-4111-8111-111111111111", "run"), /runId.*UUID/);
  assert.throws(() => client.models.cancel("11111111-1111-4111-8111-111111111111", "run"), /runId.*UUID/);
  for (const requestKey of ["", "_bad", "-bad", " bad", "x".repeat(129), "é", "A\n", "A\u2028"] ) {
    assert.throws(() => client.models.submit({ companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey, input: "hello" }), /requestKey/);
  }
  for (const input of ["", "   ", "x".repeat(65_537), "😀".repeat(16_385)]) {
    assert.throws(() => client.models.submit({ companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "ok", input }), /input/);
  }
  for (const extra of ["endpoint", "model", "key", "tools", "apiKey"]) {
    assert.throws(() => client.models.submit({ companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "ok", input: "hello", [extra]: "forbidden" }), /only companyId, connectionId, requestKey, input/);
  }
  let modelGetterCalls = 0;
  const accessorInput = { companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "ok" };
  Object.defineProperty(accessorInput, "input", { enumerable: true, get() { modelGetterCalls += 1; return "hello"; } });
  assert.throws(() => client.models.submit(accessorInput), /own data property/);
  const symbolInput = { companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "ok", input: "hello", [Symbol("extra")]: true };
  assert.throws(() => client.models.submit(symbolInput), /only companyId, connectionId, requestKey, input/);
  const customPrototypeInput = Object.assign(Object.create({ inherited: true }), { companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "ok", input: "hello" });
  assert.throws(() => client.models.submit(customPrototypeInput), /plain object/);
  assert.equal(modelGetterCalls, 0);
  assert.throws(() => client.executionGrants.upsert({ companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: 7 }), /runnerProfileId/);
  assert.throws(() => client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: ["ok", 7] }), /args/);
  assert.throws(() => client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: [], env: { BAD: 7 } }), /env/);
  assert.throws(() => client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: [], timeoutMs: -1 }), /timeoutMs/);
  assert.throws(() => client.runs.list("company-1", { subjectKey: 7 }), /subjectKey/);
  assert.throws(() => client.runs.list("company-1", { status: false }), /status/);
  assert.throws(() => client.runs.list("company-1", { limit: 1.5 }), /limit/);
  assert.throws(() => client.runs.list("company-1", { limit: 0 }), /limit/);
  assert.throws(() => client.runs.list("company-1", { limit: 201 }), /less than or equal to 200/);
  assert.throws(() => client.runs.list("company-1", { beforeId: 12 }), /beforeId/);
  assert.throws(() => client.runs.cancel("company-1", " "), /runId/);
  assert.throws(() => client.runs.listEvents("company-1", "run-1", { afterSequence: 1.5 }), /afterSequence/);
  assert.throws(() => client.artifacts.publish({ companyId: "company-1", subjectKey: "subject-1", title: "Build", data: { unsafe: () => "not json" } }), /data/);
  assert.throws(() => client.artifacts.list("company-1", { limit: 0 }), /limit/);
  assert.equal(transportCalls, 0);
});

test("model request input accepts the full bounded UTF-8 payload", async () => {
  let forwarded;
  const client = createSpsRuntimeClient({ async request(operation, input) { forwarded = { operation, input }; return {}; } });
  const input = "😀".repeat(16_384);
  await client.models.submit({
    companyId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    requestKey: `A${"b".repeat(127)}`,
    input,
  });
  assert.equal(forwarded.operation, "sps.models.submit");
  assert.equal(forwarded.input.input, input);
});

test("execution summaries accept the inclusive 31-day maximum", async () => {
  const calls = [];
  const client = createSpsRuntimeClient({ async request(operation, input) { calls.push({ operation, input }); return {}; } });
  await client.executions.summarize("11111111-1111-4111-8111-111111111111", {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-11-01T00:00:00.000Z",
  });
  assert.deepEqual(calls, [{
    operation: "sps.executions.summarize",
    input: {
      companyId: "11111111-1111-4111-8111-111111111111",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-11-01T00:00:00.000Z",
    },
  }]);
});

test("model request history is a supported execution lane", async () => {
  const calls = [];
  const client = createSpsRuntimeClient({ async request(operation, input) { calls.push({ operation, input }); return {}; } });
  await client.executions.list("company-1", { lane: "model_request" });
  await client.executions.get("company-1", "model_request", "11111111-1111-4111-8111-111111111111");
  await client.executions.summarize("11111111-1111-4111-8111-111111111111", {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
    lane: "model_request",
  });
  assert.deepEqual(calls.map(({ input }) => input.lane), ["model_request", "model_request", "model_request"]);
});

test("optional runtime fields are omitted instead of crossing Worker RPC as undefined", async () => {
  const calls = [];
  const client = createSpsRuntimeClient({
    async request(operation, input) {
      calls.push({ operation, input });
      assert.doesNotThrow(() => JSON.stringify(input));
      return [];
    },
  });

  await client.runtimes.list("company-1");
  await client.executions.list("company-1");
  await client.executions.get("company-1", "agent_session", "33333333-3333-4333-8333-333333333333");
  await client.executions.summarize("11111111-1111-4111-8111-111111111111", { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" });
  await client.executionGrants.list("company-1");
  await client.executionGrants.upsert({
    companyId: "company-1",
    subjectKey: "subject-1",
    nodeId: "node-1",
    runnerProfileId: "profile-1",
  });
  await client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: [] });
  await client.runs.list("company-1");
  await client.runs.listEvents("company-1", "run-1");
  await client.runs.cancel("company-1", "run-1");
  await client.artifacts.publish({ companyId: "company-1", subjectKey: "subject-1", title: "Build" });
  await client.artifacts.list("company-1");

  assert.deepEqual(calls, [
    { operation: "sps.runtimes.list", input: { companyId: "company-1" } },
    { operation: "sps.executions.list", input: { companyId: "company-1" } },
    { operation: "sps.executions.get", input: { companyId: "company-1", lane: "agent_session", runId: "33333333-3333-4333-8333-333333333333" } },
    { operation: "sps.executions.summarize", input: { companyId: "11111111-1111-4111-8111-111111111111", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" } },
    { operation: "sps.executionGrants.list", input: { companyId: "company-1" } },
    { operation: "sps.executionGrants.upsert", input: { companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: "profile-1" } },
    { operation: "sps.runs.dispatch", input: { companyId: "company-1", executionGrantId: "grant-1", args: [] } },
    { operation: "sps.runs.list", input: { companyId: "company-1" } },
    { operation: "sps.runs.listEvents", input: { companyId: "company-1", runId: "run-1" } },
    { operation: "sps.runs.cancel", input: { companyId: "company-1", runId: "run-1" } },
    { operation: "sps.artifacts.publish", input: { companyId: "company-1", subjectKey: "subject-1", title: "Build" } },
    { operation: "sps.artifacts.list", input: { companyId: "company-1" } },
  ]);
});

test("runtime contract helper mirrors Profile 2.0's finite primitive vocabulary and dependencies", () => {
  assert.deepEqual(defineSpsRuntimeContract({ primitives: ["workspace.sources.metadata", "workspace.sources.route", "runtimes.list", "runtimes.dispatch", "executions.observe", "runs.observe", "runs.cancel"] }), {
    contractVersion: "2.0",
    primitives: ["workspace.sources.metadata", "workspace.sources.route", "runtimes.list", "runtimes.dispatch", "executions.observe", "runs.observe", "runs.cancel"],
  });
  assert.throws(() => defineSpsRuntimeContract({ contractVersion: "2.1", primitives: [] }), /contractVersion/);
  assert.throws(() => defineSpsRuntimeContract({ primitives: ["unknown.primitive"] }), /Unsupported SPS Core primitives/);
  assert.throws(() => defineSpsRuntimeContract({ primitives: ["workspace.sources.route"] }), /requires workspace.sources.metadata/);
  assert.throws(() => defineSpsRuntimeContract({ primitives: ["runtimes.dispatch"] }), /requires runtimes.list/);
});
