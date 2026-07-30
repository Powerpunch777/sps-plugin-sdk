import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPluginWorker } from "./worker-bundle-v1.mjs";

test("bundles the fixed Worker source as Node-targeted ESM", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-worker-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await (await import("node:fs/promises")).mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "worker.mjs"), "export const lifecycle = 'ready';\n", "utf8");

  const result = await buildPluginWorker({ sourceDirectory: root });
  assert.equal(result.outputPath, path.join(root, "dist", "worker.js"));
  assert.match(await readFile(result.outputPath, "utf8"), /lifecycle/);
});

test("rejects a dist junction before writing outside the plugin root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-worker-bundle-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "sps-worker-bundle-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "worker.mjs"), "export {};\n", "utf8");
  await symlink(outside, path.join(root, "dist"), "junction");

  await assert.rejects(() => buildPluginWorker({ sourceDirectory: root }), /symbolic link or junction/);
  await assert.rejects(() => readFile(path.join(outside, "worker.js")));
});
