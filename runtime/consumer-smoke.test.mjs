import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredTypeScriptPath = process.env.SPS_SDK_TYPESCRIPT_PATH;

if (configuredTypeScriptPath !== undefined && !path.isAbsolute(configuredTypeScriptPath)) {
  throw new TypeError("SPS_SDK_TYPESCRIPT_PATH must be an absolute TypeScript compiler entry path.");
}
const typeScriptCompilerPath = configuredTypeScriptPath
  ? path.resolve(configuredTypeScriptPath)
  : path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc");

async function run(stage, command, args, cwd, signal) {
  const useNpmCli = command === "npm" && (
    typeof process.env.npm_execpath === "string"
    || process.platform === "win32"
  );
  const npmCliPath = process.env.npm_execpath
    ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const executable = useNpmCli ? process.execPath : command;
  const executableArgs = useNpmCli ? [npmCliPath, ...args] : args;
  const child = execFile(executable, executableArgs, { cwd, windowsHide: true, signal });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  const completion = await new Promise((resolve) => {
    let spawnError;
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code, exitSignal) => resolve({ code, exitSignal, spawnError }));
  });
  if (completion.spawnError || completion.code !== 0) {
    const detail = completion.spawnError?.message ?? `exit ${completion.code}${completion.exitSignal ? ` (${completion.exitSignal})` : ""}`;
    throw new Error(`${stage}: ${command} ${args.join(" ")} failed (${detail}):\n${stdout}\n${stderr}`);
  }
  return stdout;
}

test("an external temporary project imports the packed public runtime facade", { timeout: 120_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-sdk-consumer-"));
  try {
    t.diagnostic("consumer smoke stage: npm pack");
    const packed = JSON.parse(await run("npm pack", "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot, t.signal));
    const tarball = path.join(root, packed[0].filename);
    assert.ok(packed[0].files.some((file) => file.path === "runtime/index.mjs"));
    assert.ok(packed[0].files.some((file) => file.path === "runtime/index.d.ts"));
    assert.ok(packed[0].files.some((file) => file.path === "runtime/host-support.mjs"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sps-sdk-consumer-smoke", private: true, type: "module" }));
    t.diagnostic("consumer smoke stage: install packed SDK dependencies");
    await run("npm install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], root, t.signal);
    await fs.writeFile(path.join(root, "smoke.ts"), [
      'import { createSpsRuntimeClient, defineSpsRuntimeContract, readSpsHostSupport, SPS_HOST_OPERATIONS, type PluginSpsConnectivitySnapshot, type PluginSpsExecutionSummary, type PluginSpsExecutionSummaryOptions, type PluginSpsModelConnection, type PluginSpsModelRun, type PluginSpsModelSubmitInput, type PluginSpsModelTextResult, type PluginSpsRun, type PluginSpsRuntime, type PluginSpsRuntimeConnection, type PluginSpsUsageAggregateMetric, type SpsExecution, type SpsExecutionLane, type SpsExecutionPage, type SpsExecutionSummary, type SpsExecutionSummaryOptions, type SpsHostOperation, type SpsHostSupport, type SpsRuntimeOperation, type SpsRuntimeTransport, type SpsUsageAggregateMetric } from "@sonparkserver/plugin-sdk/runtime";',
      'import type { SpsAgentExecutionDescriptor, SpsAgentSessionClient, SpsAgentSessionRunResult } from "@sonparkserver/plugin-sdk/platform";',
      'declare const agents: SpsAgentSessionClient;',
      'const describeExecution: (agentId: string, companyId: string) => Promise<SpsAgentExecutionDescriptor> = agents.describeExecution;',
      'const agentDescriptor: SpsAgentExecutionDescriptor = { agentId: "agent", adapterType: "adapter", state: "configured", adapterRegistration: "registered", executionOwner: "node", authorization: "recheck_on_dispatch", readiness: "unknown", node: { id: null, state: "unverified", observedAt: null } };',
      'const transport: SpsRuntimeTransport = { request: async () => [] };',
      'const runtime = createSpsRuntimeClient(transport);',
      'const connectivity: Promise<PluginSpsConnectivitySnapshot> = runtime.connectivity.current();',
      'const modelLane: SpsExecutionLane = "model_request";',
      'const modelOperation: SpsRuntimeOperation = "sps.models.submit";',
      'const modelInput: PluginSpsModelSubmitInput = { companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "consumer:request-1", input: "hello" };',
      'const modelConnections: Promise<PluginSpsModelConnection[]> = runtime.models.list(modelInput.companyId);',
      'const modelHistory: Promise<SpsExecutionPage> = runtime.executions.list(modelInput.companyId, { lane: modelLane });',
      'const modelRun: Promise<PluginSpsModelRun> = runtime.models.submit(modelInput);',
      'const modelGet: Promise<PluginSpsModelRun | null> = runtime.models.get(modelInput.companyId, "33333333-3333-4333-8333-333333333333");',
      'const modelCancel: Promise<PluginSpsModelRun | null> = runtime.models.cancel(modelInput.companyId, "33333333-3333-4333-8333-333333333333");',
      'const modelConnection: PluginSpsModelConnection = { id: modelInput.connectionId, displayName: "Primary", protocol: "responses_text_v1", model: "example-model", state: "configured", executionOwner: "host", authorization: "grant_required", readiness: "unknown", limits: { timeoutMs: 1000, maxOutputTokens: 128, maxRequestBytes: 65536, maxResponseBytes: 4096 } };',
      'const modelText: PluginSpsModelTextResult = { status: "completed", text: "ok", refusal: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };',
      'const modelRunValue: PluginSpsModelRun = { id: "33333333-3333-4333-8333-333333333333", companyId: modelInput.companyId, connectionId: modelInput.connectionId, status: "queued", externalEffects: "not_dispatched", errorCode: null, cancellationRequested: false, cleanupPending: false, resultState: "not_ready", result: null, createdAt: "2026-10-25T00:00:00.000Z", startedAt: null, finishedAt: null };',
      'const history: Promise<SpsExecutionPage> = runtime.executions.list("external-company", { lane: "agent_session", limit: 25, before: { createdAt: "2026-10-22T12:34:56.789Z", runId: "11111111-1111-4111-8111-111111111111", lane: "node" } });',
      'const execution: Promise<SpsExecution | null> = runtime.executions.get("external-company", "node", "22222222-2222-4222-8222-222222222222");',
      'const summaryOptions: SpsExecutionSummaryOptions = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", lane: "agent_session", agentId: "22222222-2222-4222-8222-222222222222" };',
      'const pluginSummaryOptions: PluginSpsExecutionSummaryOptions = summaryOptions;',
      'const summary: Promise<SpsExecutionSummary> = runtime.executions.summarize("11111111-1111-4111-8111-111111111111", summaryOptions);',
      'declare const summaryValue: PluginSpsExecutionSummary;',
      'const publicMetric: SpsUsageAggregateMetric = summaryValue.tokens.inputTokens;',
      'const pluginMetric: PluginSpsUsageAggregateMetric = publicMetric;',
      'declare const observed: SpsExecution;',
      'const sessionRun: SpsAgentSessionRunResult = { runId: "run", status: "running", cancellationRequested: false, termination: "not_applicable", errorCode: null, error: null, execution: observed };',
      'const runtimes: Promise<PluginSpsRuntime[]> = runtime.runtimes.list("external-company", { nodeId: null });',
      'const connection: PluginSpsRuntimeConnection = { executionOwner: "node", authorization: "execution_grant_required", state: "recently_seen", observedAt: "2026-10-25T12:00:00.000Z" };',
      'const runtimeFields: Omit<PluginSpsRuntime, "connection"> = { id: "runtime-1", nodeId: "node-1", nodeLabel: "Node 1", kind: "node", runnerKey: "runner", label: "Runner", profileLabel: null, credentialStatus: "unknown", availabilityStatus: "unknown", availabilityDetail: null, availabilityObservedAt: null, retryAfter: null, online: false };',
      'const runtimeWithConnection: PluginSpsRuntime = { ...runtimeFields, connection };',
      'const legacyRuntime: PluginSpsRuntime = { ...runtimeFields };',
      'const runs: Promise<PluginSpsRun[]> = runtime.runs.list("external-company", { subjectKey: null, status: "running", limit: 10, beforeId: null });',
      'const cancelled: Promise<PluginSpsRun> = runtime.runs.cancel("external-company", "run-1");',
      'const contract = defineSpsRuntimeContract({ primitives: ["runtimes.list", "runtimes.dispatch", "runs.observe", "runs.cancel"] });',
      'const hostOperation: SpsHostOperation = "agents.describeExecution";',
      'const hostSupport: SpsHostSupport = readSpsHostSupport({ spsHost: { contractVersion: "1.0", operations: ["agents.list", "future.handlers.lookup"] } });',
      'const knownHostOperations: readonly SpsHostOperation[] = SPS_HOST_OPERATIONS;',
      'void runtimes;',
      'void connectivity;',
      'void modelLane;',
      'void modelOperation;',
      'void modelConnections;',
      'void modelHistory;',
      'void modelRun;',
      'void modelGet;',
      'void modelCancel;',
      'void modelConnection;',
      'void modelText;',
      'void modelRunValue;',
      'void connection;',
      'void runtimeWithConnection;',
      'void legacyRuntime;',
      'void history;',
      'void execution;',
      'void pluginSummaryOptions;',
      'void summary;',
      'void pluginMetric;',
      'void sessionRun;',
      'void describeExecution;',
      'void agentDescriptor;',
      'void runs;',
      'void cancelled;',
      'void contract;',
      'void hostOperation;',
      'void hostSupport;',
      'void knownHostOperations;',
    ].join("\n"));
    t.diagnostic("consumer smoke stage: packed TypeScript consumer");
    const compilerStat = await fs.stat(typeScriptCompilerPath);
    assert.ok(compilerStat.isFile(), "configured TypeScript compiler entry must be a file");
    await run("packed TypeScript consumer", process.execPath, [
      typeScriptCompilerPath,
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
      "smoke.ts",
    ], root, t.signal);
    await fs.writeFile(path.join(root, "smoke.mjs"), [
      'import { createSpsRuntimeClient, defineSpsRuntimeContract, readSpsHostSupport } from "@sonparkserver/plugin-sdk/runtime";',
      'const calls = [];',
      'const runtime = createSpsRuntimeClient({ request: async (operation, input) => { calls.push({ operation, input }); return operation === "sps.connectivity.current" ? { state: "unavailable", transport: "native_tls", hostId: null, workspaceId: "11111111-1111-4111-8111-111111111111", authorization: "unknown", evidence: "none", observedAt: "2026-10-27T10:20:30.000Z" } : { ok: true }; } });',
      'await runtime.models.list("11111111-1111-4111-8111-111111111111");',
      'await runtime.connectivity.current();',
      'await runtime.models.submit({ companyId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", requestKey: "smoke:1", input: "hello" });',
      'await runtime.runs.list("external-company", { status: "queued", limit: 5 });',
      'await runtime.runs.cancel("external-company", "run-1");',
      'await runtime.executions.summarize("11111111-1111-4111-8111-111111111111", { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" });',
      'const contract = defineSpsRuntimeContract({ primitives: ["runs.observe", "runs.cancel"] });',
      'const hostSupport = readSpsHostSupport({ spsHost: { contractVersion: "1.0", operations: ["agents.list"] } });',
      'if (calls[0].operation !== "sps.models.list" || calls[1].operation !== "sps.connectivity.current" || Object.keys(calls[1].input).length !== 0 || calls[2].operation !== "sps.models.submit" || calls[2].input.requestKey !== "smoke:1" || calls[3].operation !== "sps.runs.list" || calls[3].input.status !== "queued" || calls[4].operation !== "sps.runs.cancel" || calls[5].operation !== "sps.executions.summarize" || contract.contractVersion !== "2.0" || hostSupport.operations[0] !== "agents.list") process.exit(1);',
    ].join("\n"));
    t.diagnostic("consumer smoke stage: packed JavaScript consumer");
    await run("packed JavaScript consumer", "node", ["smoke.mjs"], root, t.signal);
    assert.ok(await fs.stat(path.join(root, "node_modules", "@sonparkserver", "plugin-sdk", "runtime", "index.mjs")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
