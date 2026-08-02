import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractTarGz, runConsumerCommand } from "../testing/consumer-test-helpers.mjs";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("packed SDK exposes the dependency analyzer with self-reference types", { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-dependency-consumer-"));
  try {
    const packed = JSON.parse(await runConsumerCommand("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], sdkRoot));
    const tarball = path.join(root, packed[0].filename);
    for (const file of ["dependency/v1.mjs", "dependency/v1.d.ts"]) assert.ok(packed[0].files.some((entry) => entry.path === file));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sps-dependency-consumer", private: true, type: "module" }));
    const unpacked = path.join(root, "unpacked"); await extractTarGz(tarball, unpacked, root);
    const installed = path.join(root, "node_modules", "@sonparkserver", "plugin-sdk"); await fs.mkdir(path.dirname(installed), { recursive: true }); await fs.cp(path.join(unpacked, "package"), installed, { recursive: true });
    await fs.writeFile(path.join(root, "smoke.ts"), [
      'import { analyzeSpsPluginDependenciesV1, type SpsPluginDependencyAnalysisV1 } from "@sonparkserver/plugin-sdk/dependency/v1";',
      'const report: SpsPluginDependencyAnalysisV1 = analyzeSpsPluginDependenciesV1({ plugins: [{ id: "com.example.app", version: "1.0.0" }] });',
      'if (report.status !== "ready") throw new Error("unexpected");',
    ].join("\n"));
    await runConsumerCommand(process.execPath, [path.join(sdkRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "smoke.ts"], root);
    await fs.writeFile(path.join(root, "smoke.mjs"), 'import { analyzeSpsPluginDependenciesV1 } from "@sonparkserver/plugin-sdk/dependency/v1"; const result = analyzeSpsPluginDependenciesV1({ plugins: [{ id: "com.example.app", version: "1.0.0" }] }); if (result.status !== "ready") process.exit(1);');
    await runConsumerCommand("node", ["smoke.mjs"], root);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
