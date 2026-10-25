import assert from "node:assert/strict";
import test from "node:test";
import { SPS_HOST_OPERATIONS, readSpsHostSupport } from "./host-support.mjs";
import { SPS_RUNTIME_OPERATIONS } from "./index.mjs";

const agentOperations = [
  "agents.describeExecution",
  "agents.list",
  "agents.sessions.create",
  "agents.sessions.list",
  "agents.sessions.sendMessage",
  "agents.sessions.getRun",
  "agents.sessions.cancel",
];

function report(operations, contractVersion = "1.0") {
  return { spsHost: { contractVersion, operations } };
}

test("known Host operations are the runtime facade plus the public agent handlers", () => {
  assert.equal(SPS_HOST_OPERATIONS.length, SPS_RUNTIME_OPERATIONS.length + agentOperations.length);
  assert.deepEqual([...SPS_HOST_OPERATIONS].sort(), [...new Set([...SPS_RUNTIME_OPERATIONS, ...agentOperations])].sort());
  assert.deepEqual(SPS_HOST_OPERATIONS, [...SPS_HOST_OPERATIONS].sort());
  assert.ok(Object.isFrozen(SPS_HOST_OPERATIONS));
  assert.ok(!SPS_HOST_OPERATIONS.includes("agents.sessions.close"));
});

test("missing, inherited, accessor, and future Host reports remain unknown", () => {
  const missing = readSpsHostSupport(undefined);
  assert.deepEqual(missing, { state: "unknown", contractVersion: null, operations: [] });
  assert.notStrictEqual(readSpsHostSupport(undefined).operations, missing.operations);
  assert.deepEqual(readSpsHostSupport({}), { state: "unknown", contractVersion: null, operations: [] });
  assert.deepEqual(readSpsHostSupport({ apiVersion: "1.0", hostVersion: "99.0" }), {
    state: "unknown", contractVersion: null, operations: [],
  });
  assert.deepEqual(readSpsHostSupport(Object.create({ spsHost: { contractVersion: "1.0", operations: ["agents.list"] } })), {
    state: "unknown", contractVersion: null, operations: [],
  });

  let getterCalls = 0;
  const params = Object.defineProperty({}, "spsHost", {
    get() { getterCalls += 1; return { contractVersion: "1.0", operations: ["agents.list"] }; },
  });
  assert.equal(readSpsHostSupport(params).state, "unknown");
  assert.equal(getterCalls, 0);

  assert.deepEqual(readSpsHostSupport(report(["agents.list"], "2.0")), {
    state: "unknown", contractVersion: null, operations: [],
  });
  const future = { contractVersion: "2.0", changedShape: true };
  Object.defineProperty(future, "operations", { get() { getterCalls += 1; throw new Error("Do not inspect a future contract"); } });
  assert.deepEqual(readSpsHostSupport({ spsHost: future }), missing);
  assert.equal(getterCalls, 0);
});

test("reported operations are filtered, ASCII-sorted, fresh, and immutable", () => {
  const params = report([
    "sps.runs.listEvents",
    "agents.sessions.sendMessage",
    "future.handlers.lookup",
    "agents.describeExecution",
    "agents.list",
    "sps.runs.list",
  ]);
  params.hostVersion = "private-version";
  params.token = "secret";

  const result = readSpsHostSupport(params);
  assert.deepEqual(result, {
    state: "reported",
    contractVersion: "1.0",
    operations: ["agents.describeExecution", "agents.list", "agents.sessions.sendMessage", "sps.runs.list", "sps.runs.listEvents"],
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.operations));
  assert.notStrictEqual(readSpsHostSupport(params).operations, result.operations);
  assert.throws(() => result.operations.push("agents.sessions.close"), TypeError);
});

test("malformed v1 reports fail closed with TypeError", () => {
  const malformed = [
    { spsHost: null },
    { spsHost: { contractVersion: "1.0" } },
    { spsHost: { contractVersion: "1.0", operations: "agents.list" } },
    report(["agents.list", "agents.list"]),
    report(["agents.list", 7]),
    report(["invalid"]),
    report(["agents." + "a".repeat(80)]),
    report(Array.from({ length: 129 }, (_, index) => `future.op${index}`)),
    { spsHost: { contractVersion: "1.0", operations: [], extra: true } },
    { spsHost: Object.assign(Object.create({ inherited: true }), { contractVersion: "1.0", operations: [] }) },
  ];
  for (const input of malformed) assert.throws(() => readSpsHostSupport(input), TypeError);
});

test("symbol and accessor properties are rejected without invoking getters", () => {
  let getterCalls = 0;
  const symbolHost = { contractVersion: "1.0", operations: [] };
  symbolHost[Symbol("hidden")] = true;
  assert.throws(() => readSpsHostSupport({ spsHost: symbolHost }), TypeError);
  const symbolOperations = ["agents.list"];
  symbolOperations[Symbol("hidden")] = true;
  assert.throws(() => readSpsHostSupport(report(symbolOperations)), TypeError);

  const accessorHost = { contractVersion: "1.0" };
  Object.defineProperty(accessorHost, "operations", {
    get() { getterCalls += 1; return []; },
    enumerable: true,
  });
  assert.throws(() => readSpsHostSupport({ spsHost: accessorHost }), TypeError);

  const accessorOperations = [];
  Object.defineProperty(accessorOperations, "0", {
    get() { getterCalls += 1; return "agents.list"; },
    enumerable: true,
    configurable: true,
  });
  accessorOperations.length = 1;
  assert.throws(() => readSpsHostSupport(report(accessorOperations)), TypeError);
  assert.equal(getterCalls, 0);
});

test("operation arrays must be dense bounded plain arrays", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => readSpsHostSupport(report(sparse)), TypeError);

  const extra = ["agents.list"];
  extra.note = "ignored?";
  assert.throws(() => readSpsHostSupport(report(extra)), TypeError);

  const customPrototype = ["agents.list"];
  Object.setPrototypeOf(customPrototype, {});
  assert.throws(() => readSpsHostSupport(report(customPrototype)), TypeError);
});
