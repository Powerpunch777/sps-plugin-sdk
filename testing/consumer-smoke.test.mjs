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
  const child = execFile(command === "npm" ? process.execPath : command, command === "npm" ? [npmCli, ...args] : args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, npm_config_cache: path.join(cwd, ".npm-cache") },
  });
  let stdout = ""; let stderr = ""; child.stdout.on("data", (value) => { stdout += value; }); child.stderr.on("data", (value) => { stderr += value; });
  const [code] = await once(child, "exit"); if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`); return stdout;
}

test("packed SDK exposes Diagnostics, Test Kit, and Conformance with self-reference types", { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-testkit-consumer-"));
  try {
    const packed = JSON.parse(await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot));
    const tarball = path.join(root, packed[0].filename);
    for (const file of ["diagnostics/v1.mjs", "diagnostics/v1.d.ts", "testing/v1.mjs", "testing/v1.d.ts", "conformance/v1.mjs", "conformance/v1.d.ts"]) assert.ok(packed[0].files.some((entry) => entry.path === file));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sps-test-kit-consumer", private: true, type: "module" }));
    const unpacked = path.join(root, "unpacked");
    await fs.mkdir(unpacked);
    await run("tar.exe", ["-xzf", tarball, "-C", unpacked], root);
    const installed = path.join(root, "node_modules", "@sonparkserver", "plugin-sdk");
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.cp(path.join(unpacked, "package"), installed, { recursive: true });
    await fs.writeFile(path.join(root, "smoke.ts"), [
      'import { createSpsPluginDiagnosticSinkV1, type SpsPluginDiagnosticEventV1 } from "@sonparkserver/plugin-sdk/diagnostics/v1";',
      'import { createSpsPluginTestKitV1, type SpsPluginTestKitV1 } from "@sonparkserver/plugin-sdk/testing/v1";',
      'import { createSpsPluginConformanceReportV1, type SpsPluginConformanceReportV1 } from "@sonparkserver/plugin-sdk/conformance/v1";',
      'const sink = createSpsPluginDiagnosticSinkV1(); const kit: SpsPluginTestKitV1 = createSpsPluginTestKitV1();',
      'const event: SpsPluginDiagnosticEventV1 | undefined = sink.events[0];',
      'const report: SpsPluginConformanceReportV1 = createSpsPluginConformanceReportV1({ pluginId: "example.plugin", pluginVersion: "1.0.0", generatedAt: "2026-01-01T00:00:00.000Z", checks: [{ id: "unit", status: "passed", summary: "Passed." }] });',
      'void event; void kit; void report;',
    ].join("\n"));
    await run(process.execPath, [path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "smoke.ts"], root);
    await fs.writeFile(path.join(root, "smoke.mjs"), 'import { createSpsPluginTestKitV1 } from "@sonparkserver/plugin-sdk/testing/v1"; const kit = createSpsPluginTestKitV1(); kit.invokeTool({ id: "tool" }); if (kit.diagnostics.length !== 1) process.exit(1);');
    await run("node", ["smoke.mjs"], root);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
