import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fingerprintDevelopmentBuildOutputs,
  fingerprintDevelopmentSource,
} from "./development-build-v1.mjs";

async function createBuild(root, { ui = false } = {}) {
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "manifest.js"), "export default {};\n", "utf8");
  await writeFile(path.join(root, "dist", "worker.js"), "export {};\n", "utf8");
  if (ui) await writeFile(path.join(root, "dist", "ui.js"), "export {};\n", "utf8");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ spsPlugin: ui ? { ui: "./dist/ui.js" } : {} }), "utf8");
  await writeFile(path.join(root, "sps-plugin.json"), "{}", "utf8");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "worker.mjs"), "export const value = 1;\n", "utf8");
}

test("development source fingerprint is deterministic, tracks source changes, and excludes generated and secret-like files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createBuild(root);
  const first = await fingerprintDevelopmentSource({ sourceDirectory: root });
  const second = await fingerprintDevelopmentSource({ sourceDirectory: root });
  assert.equal(first.fingerprint, second.fingerprint);

  await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "dist", "worker.js"), "changed generated output", "utf8"),
    writeFile(path.join(root, "node_modules", "ignored", "index.js"), "ignored dependency", "utf8"),
    writeFile(path.join(root, "debug.log"), "ignored log", "utf8"),
    writeFile(path.join(root, ".env.local"), "ignored secret", "utf8"),
  ]);
  const excluded = await fingerprintDevelopmentSource({ sourceDirectory: root });
  assert.equal(excluded.fingerprint, first.fingerprint);

  await writeFile(path.join(root, "src", "worker.mjs"), "export const value = 2;\n", "utf8");
  const changed = await fingerprintDevelopmentSource({ sourceDirectory: root });
  assert.notEqual(changed.fingerprint, first.fingerprint);
});

test("development output fingerprint hashes manifest, worker, and declared UI bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createBuild(root, { ui: true });
  const first = await fingerprintDevelopmentBuildOutputs({ sourceDirectory: root });
  assert.match(first.manifestSha256, /^[a-f0-9]{64}$/);
  assert.match(first.workerSha256, /^[a-f0-9]{64}$/);
  assert.match(first.uiSha256, /^[a-f0-9]{64}$/);
  await writeFile(path.join(root, "dist", "ui.js"), "export const changed = true;\n", "utf8");
  const changed = await fingerprintDevelopmentBuildOutputs({ sourceDirectory: root });
  assert.notEqual(changed.uiSha256, first.uiSha256);
});

test("development output fingerprint supports deterministic UI directories", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-ui-directory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createBuild(root);
  await mkdir(path.join(root, "dist", "ui", "assets"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "dist", "ui", "index.js"), "export {};\n", "utf8"),
    writeFile(path.join(root, "dist", "ui", "assets", "style.css"), "body {}\n", "utf8"),
    writeFile(path.join(root, "package.json"), JSON.stringify({ spsPlugin: { ui: "./dist/ui/" } }), "utf8"),
  ]);

  const first = await fingerprintDevelopmentBuildOutputs({ sourceDirectory: root });
  const second = await fingerprintDevelopmentBuildOutputs({ sourceDirectory: root });
  assert.match(first.uiSha256, /^[a-f0-9]{64}$/);
  assert.equal(second.uiSha256, first.uiSha256);

  await writeFile(path.join(root, "dist", "ui", "assets", "style.css"), "body { color: red; }\n", "utf8");
  const changed = await fingerprintDevelopmentBuildOutputs({ sourceDirectory: root });
  assert.notEqual(changed.uiSha256, first.uiSha256);
});

test("a declared UI output must exist as a regular file or directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-ui-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createBuild(root, { ui: true });
  await rm(path.join(root, "dist", "ui.js"));
  await assert.rejects(
    () => fingerprintDevelopmentBuildOutputs({ sourceDirectory: root }),
    (error) => error?.code === "OUTPUT_MISSING",
  );
});

test("development output rejects links and enforces output bounds", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-output-bounds-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "sps-development-output-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await createBuild(root);
  await mkdir(path.join(root, "dist", "ui"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ spsPlugin: { ui: "./dist/ui/" } }), "utf8");
  await writeFile(path.join(root, "dist", "ui", "large.js"), "abcdef", "utf8");
  await assert.rejects(
    () => fingerprintDevelopmentBuildOutputs({ sourceDirectory: root, limits: { maxFileBytes: 5 } }),
    (error) => error?.code === "OUTPUT_FILE_LIMIT",
  );

  await writeFile(path.join(outside, "outside.js"), "export {};\n", "utf8");
  await symlink(path.join(outside, "outside.js"), path.join(root, "dist", "ui", "outside.js"), "file");
  await assert.rejects(
    () => fingerprintDevelopmentBuildOutputs({ sourceDirectory: root }),
    (error) => error?.code === "OUTPUT_SYMLINK_REJECTED",
  );
});

test("development source rejects symlinks that could escape the source tree", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "sps-development-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await createBuild(root);
  await writeFile(path.join(outside, "outside.mjs"), "export {};", "utf8");
  await symlink(path.join(outside, "outside.mjs"), path.join(root, "src", "outside.mjs"), "file");
  await assert.rejects(
    () => fingerprintDevelopmentSource({ sourceDirectory: root }),
    (error) => error?.code === "SOURCE_SYMLINK_REJECTED",
  );
});

test("development source enforces file-count, per-file, and total-byte limits", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-development-bounds-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createBuild(root);
  await writeFile(path.join(root, "src", "large.mjs"), "abcdef", "utf8");
  await assert.rejects(
    () => fingerprintDevelopmentSource({ sourceDirectory: root, limits: { maxFileBytes: 5 } }),
    (error) => error?.code === "SOURCE_FILE_LIMIT",
  );
  await assert.rejects(
    () => fingerprintDevelopmentSource({ sourceDirectory: root, limits: { maxFiles: 1 } }),
    (error) => error?.code === "SOURCE_FILE_COUNT_LIMIT",
  );
  await assert.rejects(
    () => fingerprintDevelopmentSource({ sourceDirectory: root, limits: { maxTotalBytes: 5 } }),
    (error) => error?.code === "SOURCE_TOTAL_SIZE_LIMIT",
  );
});
