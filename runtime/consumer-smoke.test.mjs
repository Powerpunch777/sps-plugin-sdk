import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function run(command, args, cwd) {
  const useNpmCli = command === "npm" && (
    typeof process.env.npm_execpath === "string"
    || process.platform === "win32"
  );
  const npmCliPath = process.env.npm_execpath
    ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const executable = useNpmCli ? process.execPath : command;
  const executableArgs = useNpmCli ? [npmCliPath, ...args] : args;
  const child = execFile(executable, executableArgs, { cwd, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

test("an external temporary project imports the packed public runtime facade", { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-sdk-consumer-"));
  try {
    const packed = JSON.parse(await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot));
    const tarball = path.join(root, packed[0].filename);
    assert.ok(packed[0].files.some((file) => file.path === "runtime/index.mjs"));
    assert.ok(packed[0].files.some((file) => file.path === "runtime/index.d.ts"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sps-sdk-consumer-smoke", private: true, type: "module" }));
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], root);
    await fs.writeFile(path.join(root, "smoke.ts"), [
      'import { createSpsRuntimeClient, defineSpsRuntimeContract, type PluginSpsExecutionSummary, type PluginSpsExecutionSummaryOptions, type PluginSpsRun, type PluginSpsRuntime, type PluginSpsUsageAggregateMetric, type SpsExecution, type SpsExecutionPage, type SpsExecutionSummary, type SpsExecutionSummaryOptions, type SpsRuntimeTransport, type SpsUsageAggregateMetric } from "@sonparkserver/plugin-sdk/runtime";',
      'import type { SpsAgentSessionRunResult } from "@sonparkserver/plugin-sdk/platform";',
      'const transport: SpsRuntimeTransport = { request: async () => [] };',
      'const runtime = createSpsRuntimeClient(transport);',
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
      'const runs: Promise<PluginSpsRun[]> = runtime.runs.list("external-company", { subjectKey: null, status: "running", limit: 10, beforeId: null });',
      'const cancelled: Promise<PluginSpsRun> = runtime.runs.cancel("external-company", "run-1");',
      'const contract = defineSpsRuntimeContract({ primitives: ["runtimes.list", "runtimes.dispatch", "runs.observe", "runs.cancel"] });',
      'void runtimes;',
      'void history;',
      'void execution;',
      'void pluginSummaryOptions;',
      'void summary;',
      'void pluginMetric;',
      'void sessionRun;',
      'void runs;',
      'void cancelled;',
      'void contract;',
    ].join("\n"));
    await run(process.execPath, [
      path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
      "smoke.ts",
    ], root);
    await fs.writeFile(path.join(root, "smoke.mjs"), [
      'import { createSpsRuntimeClient, defineSpsRuntimeContract } from "@sonparkserver/plugin-sdk/runtime";',
      'const calls = [];',
      'const runtime = createSpsRuntimeClient({ request: async (operation, input) => { calls.push({ operation, input }); return { ok: true }; } });',
      'await runtime.runs.list("external-company", { status: "queued", limit: 5 });',
      'await runtime.runs.cancel("external-company", "run-1");',
      'await runtime.executions.summarize("11111111-1111-4111-8111-111111111111", { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" });',
      'const contract = defineSpsRuntimeContract({ primitives: ["runs.observe", "runs.cancel"] });',
      'if (calls[0].operation !== "sps.runs.list" || calls[0].input.status !== "queued" || calls[1].operation !== "sps.runs.cancel" || calls[2].operation !== "sps.executions.summarize" || contract.contractVersion !== "2.0") process.exit(1);',
    ].join("\n"));
    await run("node", ["smoke.mjs"], root);
    assert.ok(await fs.stat(path.join(root, "node_modules", "@sonparkserver", "plugin-sdk", "runtime", "index.mjs")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
