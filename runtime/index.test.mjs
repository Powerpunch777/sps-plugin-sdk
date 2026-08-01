import assert from "node:assert/strict";
import test from "node:test";
import { SPS_RUNTIME_OPERATIONS, createSpsRuntimeClient, defineSpsRuntimeContract } from "./index.mjs";

test("runtime facade uses the exact existing Host RPC names and payloads", async () => {
  const calls = [];
  const client = createSpsRuntimeClient({ async request(operation, input) { calls.push({ operation, input }); return []; } });

  await client.workspaceSources.list("company-1");
  await client.runtimes.list("company-1", { nodeId: null, command: "ignored" });
  await client.executionGrants.list("company-1", { subjectKey: null, includeRevoked: false, path: "ignored" });
  await client.executionGrants.upsert({ companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: "profile-1", workspaceSourceId: null, command: "ignored" });
  await client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: ["--safe"], env: { MODE: "test" }, stdin: null, timeoutMs: 3000, workingDirectory: "ignored" });
  await client.runs.listEvents("company-1", "run-1", { afterSequence: null, rawCommand: "ignored" });
  await client.artifacts.publish({ companyId: "company-1", subjectKey: "subject-1", runId: null, title: "Build", kind: null, referenceUrl: null, summary: null, data: { ok: true }, path: "ignored" });
  await client.artifacts.list("company-1", { subjectKey: null, runId: null, limit: null, cwd: "ignored" });

  assert.deepEqual(calls, [
    { operation: "sps.workspaceSources.list", input: { companyId: "company-1" } },
    { operation: "sps.runtimes.list", input: { companyId: "company-1", nodeId: null } },
    { operation: "sps.executionGrants.list", input: { companyId: "company-1", subjectKey: null, includeRevoked: false } },
    { operation: "sps.executionGrants.upsert", input: { companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: "profile-1", workspaceSourceId: null } },
    { operation: "sps.runs.dispatch", input: { companyId: "company-1", executionGrantId: "grant-1", args: ["--safe"], env: { MODE: "test" }, stdin: null, timeoutMs: 3000 } },
    { operation: "sps.runs.listEvents", input: { companyId: "company-1", runId: "run-1", afterSequence: null } },
    { operation: "sps.artifacts.publish", input: { companyId: "company-1", subjectKey: "subject-1", runId: null, title: "Build", kind: null, referenceUrl: null, summary: null, data: { ok: true } } },
    { operation: "sps.artifacts.list", input: { companyId: "company-1", subjectKey: null, runId: null, limit: null } },
  ]);
  assert.deepEqual(SPS_RUNTIME_OPERATIONS, [
    "sps.workspaceSources.list", "sps.runtimes.list", "sps.executionGrants.list", "sps.executionGrants.upsert", "sps.executionGrants.revoke",
    "sps.runs.dispatch", "sps.runs.get", "sps.runs.listEvents", "sps.artifacts.publish", "sps.artifacts.list",
  ]);
});

test("malformed declared fields fail before transport while raw fields are omitted", () => {
  let transportCalls = 0;
  const client = createSpsRuntimeClient({ request() { transportCalls += 1; } });

  assert.throws(() => client.runtimes.list("company-1", { nodeId: 42 }), /nodeId must be a string/);
  assert.throws(() => client.executionGrants.list("company-1", { includeRevoked: "yes" }), /includeRevoked/);
  assert.throws(() => client.executionGrants.upsert({ companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: 7 }), /runnerProfileId/);
  assert.throws(() => client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: ["ok", 7] }), /args/);
  assert.throws(() => client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: [], env: { BAD: 7 } }), /env/);
  assert.throws(() => client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: [], timeoutMs: -1 }), /timeoutMs/);
  assert.throws(() => client.runs.listEvents("company-1", "run-1", { afterSequence: 1.5 }), /afterSequence/);
  assert.throws(() => client.artifacts.publish({ companyId: "company-1", subjectKey: "subject-1", title: "Build", data: { unsafe: () => "not json" } }), /data/);
  assert.throws(() => client.artifacts.list("company-1", { limit: 0 }), /limit/);
  assert.equal(transportCalls, 0);
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
  await client.executionGrants.list("company-1");
  await client.executionGrants.upsert({
    companyId: "company-1",
    subjectKey: "subject-1",
    nodeId: "node-1",
    runnerProfileId: "profile-1",
  });
  await client.runs.dispatch({ companyId: "company-1", executionGrantId: "grant-1", args: [] });
  await client.runs.listEvents("company-1", "run-1");
  await client.artifacts.publish({ companyId: "company-1", subjectKey: "subject-1", title: "Build" });
  await client.artifacts.list("company-1");

  assert.deepEqual(calls, [
    { operation: "sps.runtimes.list", input: { companyId: "company-1" } },
    { operation: "sps.executionGrants.list", input: { companyId: "company-1" } },
    { operation: "sps.executionGrants.upsert", input: { companyId: "company-1", subjectKey: "subject-1", nodeId: "node-1", runnerProfileId: "profile-1" } },
    { operation: "sps.runs.dispatch", input: { companyId: "company-1", executionGrantId: "grant-1", args: [] } },
    { operation: "sps.runs.listEvents", input: { companyId: "company-1", runId: "run-1" } },
    { operation: "sps.artifacts.publish", input: { companyId: "company-1", subjectKey: "subject-1", title: "Build" } },
    { operation: "sps.artifacts.list", input: { companyId: "company-1" } },
  ]);
});

test("runtime contract helper mirrors Profile 2.0's finite primitive vocabulary and dependencies", () => {
  assert.deepEqual(defineSpsRuntimeContract({ primitives: ["workspace.sources.metadata", "workspace.sources.route", "runtimes.list", "runtimes.dispatch"] }), {
    contractVersion: "2.0",
    primitives: ["workspace.sources.metadata", "workspace.sources.route", "runtimes.list", "runtimes.dispatch"],
  });
  assert.throws(() => defineSpsRuntimeContract({ contractVersion: "2.1", primitives: [] }), /contractVersion/);
  assert.throws(() => defineSpsRuntimeContract({ primitives: ["unknown.primitive"] }), /Unsupported SPS Core primitives/);
  assert.throws(() => defineSpsRuntimeContract({ primitives: ["workspace.sources.route"] }), /requires workspace.sources.metadata/);
  assert.throws(() => defineSpsRuntimeContract({ primitives: ["runtimes.dispatch"] }), /requires runtimes.list/);
});
