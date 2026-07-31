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
  const child = execFile(command === "npm" ? process.execPath : command, command === "npm" ? [npmCli, ...args] : args, { cwd, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

test("packed SDK exposes the Developer Mode authoring contract to an external consumer", { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-development-consumer-"));
  try {
    const packed = JSON.parse(await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot));
    const tarball = path.join(root, packed[0].filename);
    assert.ok(packed[0].files.some((file) => file.path === "authoring/development-build-v1.mjs"));
    assert.ok(packed[0].files.some((file) => file.path === "authoring/development-build-v1.d.ts"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sps-development-consumer", private: true, type: "module" }));
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], root);
    await fs.writeFile(path.join(root, "smoke.mjs"), [
      'import { DEVELOPMENT_BUILD_SCHEMA_VERSION, createDevelopmentBuildResult } from "@sonparkserver/plugin-sdk/authoring/development-build-v1.mjs";',
      'const result = createDevelopmentBuildResult({ command: "build", success: true, sourceFingerprint: "a", manifestSha256: "b", workerSha256: "c", startedAt: new Date(0).toISOString(), completedAt: new Date(0).toISOString() });',
      'if (DEVELOPMENT_BUILD_SCHEMA_VERSION !== "development-build/v1" || result.uiSha256 !== null) process.exit(1);',
    ].join("\n"));
    await run("node", ["smoke.mjs"], root);
    await fs.writeFile(path.join(root, "smoke.ts"), [
      'import { createDevelopmentBuildResult, type DevelopmentBuildResult } from "@sonparkserver/plugin-sdk/authoring/development-build-v1.mjs";',
      'const result: DevelopmentBuildResult = createDevelopmentBuildResult({ command: "validate", success: true, sourceFingerprint: null, manifestSha256: null, workerSha256: null, startedAt: new Date(0).toISOString(), completedAt: new Date(0).toISOString() });',
      'void result;',
    ].join("\n"));
    await run(process.execPath, [
      path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "smoke.ts",
    ], root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
