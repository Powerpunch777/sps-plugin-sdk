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
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const child = execFile(command === "npm" ? process.execPath : command, command === "npm" ? [npmCli, ...args] : args, { cwd, windowsHide: true, env: { ...process.env, npm_config_cache: path.join(cwd, ".npm-cache") } });
  let stdout = ""; let stderr = ""; child.stdout.on("data", (value) => { stdout += value; }); child.stderr.on("data", (value) => { stderr += value; });
  const [code] = await once(child, "exit"); if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`); return stdout;
}

test("packed SDK exposes the dependency analyzer with self-reference types", { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-dependency-consumer-"));
  try {
    const packed = JSON.parse(await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot));
    const tarball = path.join(root, packed[0].filename);
    for (const file of ["dependency/v1.mjs", "dependency/v1.d.ts"]) assert.ok(packed[0].files.some((entry) => entry.path === file));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sps-dependency-consumer", private: true, type: "module" }));
    const unpacked = path.join(root, "unpacked"); await fs.mkdir(unpacked); await run("tar", ["-xzf", tarball, "-C", unpacked], root);
    const installed = path.join(root, "node_modules", "@sonparkserver", "plugin-sdk"); await fs.mkdir(path.dirname(installed), { recursive: true }); await fs.cp(path.join(unpacked, "package"), installed, { recursive: true });
    await fs.writeFile(path.join(root, "smoke.ts"), [
      'import { analyzeSpsPluginDependenciesV1, type SpsPluginDependencyAnalysisV1 } from "@sonparkserver/plugin-sdk/dependency/v1";',
      'const report: SpsPluginDependencyAnalysisV1 = analyzeSpsPluginDependenciesV1({ plugins: [{ id: "com.example.app", version: "1.0.0" }] });',
      'if (report.status !== "ready") throw new Error("unexpected");',
    ].join("\n"));
    await run(process.execPath, [path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "smoke.ts"], root);
    await fs.writeFile(path.join(root, "smoke.mjs"), 'import { analyzeSpsPluginDependenciesV1 } from "@sonparkserver/plugin-sdk/dependency/v1"; const result = analyzeSpsPluginDependenciesV1({ plugins: [{ id: "com.example.app", version: "1.0.0" }] }); if (result.status !== "ready") process.exit(1);');
    await run("node", ["smoke.mjs"], root);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
