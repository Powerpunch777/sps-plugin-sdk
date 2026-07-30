import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPluginTemplate,
  generatePluginSigningKeyPair,
  packagePluginDirectory,
  publishPluginToLocalRegistry,
} from "../authoring/plugin-package-v1.mjs";
import { buildPluginWorker } from "../authoring/worker-bundle-v1.mjs";
import { inspectLocalRegistry } from "../registry/local-registry-v1.mjs";
import { inspectSpsExtensionProfileV2 } from "../profile/extension-profile-v2.mjs";

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "sps-plugin.mjs");
const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function buildTemplateWorker(sourceDirectory) {
  const dependencyRoot = path.join(sourceDirectory, "node_modules", "@sonparkserver", "plugin-sdk");
  await Promise.all(["worker", "runtime", "profile"].map((directory) => cp(path.join(sdkRoot, directory), path.join(dependencyRoot, directory), { recursive: true })));
  await writeFile(path.join(dependencyRoot, "package.json"), JSON.stringify({ name: "@sonparkserver/plugin-sdk", type: "module", exports: { "./worker": "./worker/index.mjs", "./runtime": "./runtime/index.mjs" } }), "utf8");
  await buildPluginWorker({ sourceDirectory });
}

function runCli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("inspects a source tree, package, and local Registry without running plugin code", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-plugin-cli-inspect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  const archivePath = path.join(root, "weather.spsplugin");
  const registryDirectory = path.join(root, "registry");
  await createPluginTemplate({
    directory: sourceDirectory,
    pluginId: "com.example.weather",
    packageName: "@example/weather",
    displayName: "Weather",
    version: "1.0.0",
  });
  await buildTemplateWorker(sourceDirectory);
  await writeFile(path.join(sourceDirectory, "src", "worker.mjs"), [
    'import { defineSpsPlugin, runSpsWorker } from "@sonparkserver/plugin-sdk/worker";',
    "runSpsWorker(defineSpsPlugin({",
    '  async initialize({ spsTransport }) { await spsTransport.request("sps.runtimes.list", { companyId: "fixture" }); },',
    '  health() { return { status: "ok" }; },',
    "  shutdown() { return null; },",
    "}));",
    "",
  ].join("\n"), "utf8");
  await buildPluginWorker({ sourceDirectory });
  const conformance = await runCli("test", sourceDirectory);
  assert.equal(conformance.code, 0, conformance.stderr);
  const manifest = (await import(pathToFileURL(path.join(sourceDirectory, "dist", "manifest.js")).href)).default;
  const profile = inspectSpsExtensionProfileV2(manifest);
  assert.equal(profile.valid, true, profile.errors.join("\n"));
  const archive = await packagePluginDirectory({ sourceDirectory, archivePath });
  const publisher = generatePluginSigningKeyPair();
  const registryRoot = generatePluginSigningKeyPair();
  await publishPluginToLocalRegistry({
    sourceDirectory,
    registryDirectory,
    registryId: "io.sps.example",
    displayName: "Example Registry",
    publisherId: "example-studio",
    publisherKeyId: "ed25519:example-publisher",
    publisherPrivateKey: publisher.privateKey,
    registryRootKeyId: "ed25519:example-root",
    registryRootPrivateKey: registryRoot.privateKey,
  });

  for (const [target, kind] of [[sourceDirectory, "plugin-source"], [archive.archivePath, "plugin-archive"], [registryDirectory, "local-registry"]]) {
    const result = await runCli("inspect", target);
    assert.equal(result.code, 0, result.stderr);
    const inspection = JSON.parse(result.stdout);
    assert.equal(inspection.kind, kind);
    assert.equal(inspection.report.valid, true);
  }
});

test("publishes signed Publisher profile and Registry root details through the CLI", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-plugin-cli-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  const registryDirectory = path.join(root, "registry");
  const publisherKeyPath = path.join(root, "publisher-private.pem");
  const registryRootKeyPath = path.join(root, "registry-root-private.pem");
  const publisher = generatePluginSigningKeyPair();
  const registryRoot = generatePluginSigningKeyPair();
  await Promise.all([
    createPluginTemplate({
      directory: sourceDirectory,
      pluginId: "com.example.profiled",
      packageName: "@example/profiled",
      displayName: "Profiled",
      version: "1.0.0",
    }),
    writeFile(publisherKeyPath, publisher.privateKey, { encoding: "utf8", mode: 0o600 }),
    writeFile(registryRootKeyPath, registryRoot.privateKey, { encoding: "utf8", mode: 0o600 }),
  ]);
  await buildTemplateWorker(sourceDirectory);
  const result = await runCli(
    "publish-local", sourceDirectory,
    "--registry", registryDirectory,
    "--registry-id", "io.sps.example",
    "--display-name", "Example Registry",
    "--publisher-id", "example-studio",
    "--publisher-key-id", "ed25519:example-publisher",
    "--publisher-private-key", publisherKeyPath,
    "--root-key-id", "ed25519:example-root",
    "--root-private-key", registryRootKeyPath,
    "--publisher-name", "Example Studio",
    "--publisher-url", "https://example.test",
  );
  assert.equal(result.code, 0, result.stderr);
  const published = JSON.parse(result.stdout);
  assert.deepEqual(published.plugin, { id: "com.example.profiled", version: "1.0.0" });
  assert.equal(published.registry.rootKeyId, "ed25519:example-root");
  assert.equal(published.registry.rootPublicKey, registryRoot.publicKey);
  const inspection = await inspectLocalRegistry(registryDirectory);
  assert.equal(inspection.valid, true);
  assert.deepEqual(inspection.releases[0].publisherProfile, {
    id: "example-studio",
    displayName: "Example Studio",
    websiteUrl: "https://example.test",
  });
});
