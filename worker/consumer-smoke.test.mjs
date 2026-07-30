import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function run(command, args, cwd) {
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const child = execFile(command === "npm" ? process.execPath : command, command === "npm" ? [npmCli, ...args] : args, { cwd, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

test("packed SDK starts an external Worker and cleanly completes the Host lifecycle on Windows", { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-worker-consumer-"));
  try {
    const packed = JSON.parse(await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot));
    const tarball = path.join(root, packed[0].filename);
    assert.ok(packed[0].files.some((file) => file.path === "worker/index.mjs"));
    assert.ok(packed[0].files.some((file) => file.path === "worker/index.d.ts"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "worker-consumer", private: true, type: "module" }));
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], root);
    await fs.writeFile(path.join(root, "worker.ts"), [
      'import { defineSpsPlugin, runSpsWorker, type SpsWorkerLifecycleContext } from "@sonparkserver/plugin-sdk/worker";',
      'const initialize = async ({ spsTransport }: SpsWorkerLifecycleContext) => { await spsTransport.request("sps.runtimes.list", { companyId: "company-1" }); return { ok: true }; };',
      'const definition = defineSpsPlugin({ initialize, health: () => ({ status: "ok" }), shutdown: () => ({ stopped: true }) });',
      'void runSpsWorker(definition);',
    ].join("\n"));
    await run(process.execPath, [path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "worker.ts"], root);
    await fs.writeFile(path.join(root, "worker.mjs"), [
      'import { defineSpsPlugin, runSpsWorker } from "@sonparkserver/plugin-sdk/worker";',
      'runSpsWorker(defineSpsPlugin({',
      '  async initialize({ spsTransport }) { await spsTransport.request("sps.runtimes.list", { companyId: "company-1" }); return { pluginPrivate: true }; },',
      '  health() { return { status: "ok" }; },',
      '  shutdown() { return { stopped: true }; },',
      '}));',
    ].join("\n"));
    const child = spawn(process.execPath, ["worker.mjs"], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const exited = once(child, "exit");
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const waitFor = async (count) => {
      for (let index = 0; index < 100; index += 1) {
        const lines = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
        if (lines.length >= count) return lines;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail(`Timed out. stdout=${stdout} stderr=${stderr}`);
    };
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    let messages = await waitFor(1);
    assert.deepEqual(messages[0], { jsonrpc: "2.0", id: "sps-1", method: "sps.runtimes.list", params: { companyId: "company-1" } });
    send({ jsonrpc: "2.0", id: "sps-1", result: [] });
    messages = await waitFor(2);
    assert.deepEqual(messages[1], { jsonrpc: "2.0", id: 1, result: { ok: true, supportedMethods: ["health", "shutdown"] } });
    send({ jsonrpc: "2.0", id: 2, method: "health" });
    messages = await waitFor(3);
    assert.deepEqual(messages[2], { jsonrpc: "2.0", id: 2, result: { status: "ok" } });
    send({ jsonrpc: "2.0", id: 3, method: "shutdown" });
    messages = await waitFor(4);
    assert.deepEqual(messages[3], { jsonrpc: "2.0", id: 3, result: { stopped: true } });
    const [code] = await exited;
    assert.equal(code, 0, stderr);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
