import assert from "node:assert/strict";
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectLocalRegistry } from "../registry/local-registry-v1.mjs";
import { inspectSpsExtensionProfileV2 } from "../profile/extension-profile-v2.mjs";
import {
  createPluginTemplate,
  createSignedPluginRelease,
  createSignedRegistryIndex,
  generatePluginSigningKeyPair,
  inspectPluginDirectory,
  packagePluginDirectory,
  publishPluginToLocalRegistry,
} from "./plugin-package-v1.mjs";
import { buildPluginWorker } from "./worker-bundle-v1.mjs";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makePlugin(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-plugin-authoring-"));
  const sourceDirectory = path.join(root, "source");
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = await createPluginTemplate({
    directory: sourceDirectory,
    pluginId: "com.example.weather",
    packageName: "@example/weather",
    displayName: "Weather",
    version: "1.2.3",
  });
  // Mimic npm installing only the public SDK package. Packaging must still
  // omit this dependency after the Worker has been bundled.
  const dependencyRoot = path.join(sourceDirectory, "node_modules", "@sonparkserver", "plugin-sdk");
  await cp(path.join(sdkRoot, "worker"), path.join(dependencyRoot, "worker"), { recursive: true });
  await cp(path.join(sdkRoot, "runtime"), path.join(dependencyRoot, "runtime"), { recursive: true });
  await cp(path.join(sdkRoot, "profile"), path.join(dependencyRoot, "profile"), { recursive: true });
  await writeFile(path.join(dependencyRoot, "package.json"), JSON.stringify({ name: "@sonparkserver/plugin-sdk", type: "module", exports: { "./worker": "./worker/index.mjs", "./runtime": "./runtime/index.mjs" } }), "utf8");
  await buildPluginWorker({ sourceDirectory });
  return { root, sourceDirectory };
}

test("creates a source tree whose static manifest can be packaged without importing runtime code", async (t) => {
  const { root, sourceDirectory } = await makePlugin(t);
  const inspected = await inspectPluginDirectory(sourceDirectory);
  assert.equal(inspected.valid, true);
  const runtime = await readFile(path.join(sourceDirectory, "dist", "manifest.js"), "utf8");
  const workerSource = await readFile(path.join(sourceDirectory, "src", "worker.mjs"), "utf8");
  const worker = await readFile(path.join(sourceDirectory, "dist", "worker.js"), "utf8");
  assert.match(runtime, /apiVersion: 1/);
  assert.match(runtime, /entrypoints: \{ worker: "\.\/dist\/worker\.js" \}/);
  assert.match(runtime, /sps: \{ contractVersion: "2\.0", primitives: \[\] \}/);
  assert.match(workerSource, /@sonparkserver\/plugin-sdk\/worker/);
  assert.match(worker, /runSpsWorker/);
  assert.doesNotMatch(worker, /from\s+["']@(?:sonparkserver|paperclipai)\//);
  const runtimeManifest = (await import(pathToFileURL(path.join(sourceDirectory, "dist", "manifest.js")).href)).default;
  assert.deepEqual(runtimeManifest, {
    id: "com.example.weather",
    apiVersion: 1,
    version: "1.2.3",
    displayName: "Weather",
    description: "Generated SPS Plugin.",
    author: "SPS Plugin Author",
    categories: ["automation"],
    minimumHostVersion: "0.4.0",
    capabilities: ["plugin.state.read"],
    entrypoints: { worker: "./dist/worker.js" },
    sps: { contractVersion: "2.0", primitives: [] },
  });
  const profile = inspectSpsExtensionProfileV2(runtimeManifest);
  assert.equal(profile.valid, true, profile.errors.join("\n"));
  assert.equal(profile.extension, null);
  assert.deepEqual(profile.corePrimitives, []);
  const packageManifest = JSON.parse(await readFile(path.join(sourceDirectory, "package.json"), "utf8"));
  assert.deepEqual(packageManifest.spsPlugin, { manifest: "./dist/manifest.js", worker: "./dist/worker.js" });
  assert.equal(packageManifest.scripts.build, "sps-plugin build .");
  const sdkPackage = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
  assert.equal(packageManifest.devDependencies["@sonparkserver/plugin-sdk"], `github:Powerpunch777/sps-plugin-sdk#v${sdkPackage.version}`);
  assert.equal(Object.hasOwn(packageManifest, "paperclipPlugin"), false);
  const readme = await readFile(path.join(sourceDirectory, "README.md"), "utf8");
  assert.match(readme, /uses `package\.json\.spsPlugin` for native SPS package discovery/);
  assert.match(readme, /`package\.json\.paperclipPlugin` key only as a legacy alias/);
  const archive = await packagePluginDirectory({
    sourceDirectory,
    archivePath: path.join(root, "weather.spsplugin"),
  });
  assert.equal(archive.archive.valid, true);
  assert.equal(archive.archive.package.staticManifest.plugin.id, "com.example.weather");
});

test("rejects a build without the fixed source Worker", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sps-plugin-worker-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => buildPluginWorker({ sourceDirectory: root }), /src\/worker\.mjs/);
});

test("refuses to publish a release whose declared plugin API differs from its package", async (t) => {
  const { root, sourceDirectory } = await makePlugin(t);
  const keys = generatePluginSigningKeyPair();
  const archive = await packagePluginDirectory({
    sourceDirectory,
    archivePath: path.join(root, "weather.spsplugin"),
  });

  await assert.rejects(
    () => createSignedPluginRelease({
      archivePath: archive.archivePath,
      artifactUrl: "packages/weather.spsplugin",
      publisherId: "example-studio",
      publisherKeyId: "ed25519:example-studio",
      publisherPrivateKey: keys.privateKey,
      pluginApi: 2,
    }),
    /must match the packaged plugin API version/,
  );
});

test("bundles the generated SDK Worker without retaining its source package import", async (t) => {
  const { sourceDirectory } = await makePlugin(t);
  const worker = await readFile(path.join(sourceDirectory, "dist", "worker.js"), "utf8");
  assert.match(worker, /SPS Worker has already been initialized/);
  assert.doesNotMatch(worker, /from\s+["']@(?:sonparkserver|paperclipai)\//);
});

test("publishes immutable releases to a verified local Registry without copying private keys", async (t) => {
  const { root, sourceDirectory } = await makePlugin(t);
  const secondSource = path.join(root, "source-v2");
  await createPluginTemplate({
    directory: secondSource,
    pluginId: "com.example.weather",
    packageName: "@example/weather",
    displayName: "Weather",
    version: "1.2.4",
  });
  const secondDependencyRoot = path.join(secondSource, "node_modules", "@sonparkserver", "plugin-sdk");
  await Promise.all(["worker", "runtime", "profile"].map((directory) => cp(path.join(sdkRoot, directory), path.join(secondDependencyRoot, directory), { recursive: true })));
  await writeFile(path.join(secondDependencyRoot, "package.json"), JSON.stringify({ name: "@sonparkserver/plugin-sdk", type: "module", exports: { "./worker": "./worker/index.mjs", "./runtime": "./runtime/index.mjs" } }), "utf8");
  await buildPluginWorker({ sourceDirectory: secondSource });
  const publisher = generatePluginSigningKeyPair();
  const registryRoot = generatePluginSigningKeyPair();
  const registryDirectory = path.join(root, "team-registry");
  const publish = (directory, publishedAt) => publishPluginToLocalRegistry({
    sourceDirectory: directory,
    registryDirectory,
    registryId: "io.sps.team",
    displayName: "Team Registry",
    publisherId: "example-studio",
    publisherKeyId: "ed25519:example-publisher",
    publisherPrivateKey: publisher.privateKey,
    registryRootKeyId: "ed25519:team-root",
    registryRootPrivateKey: registryRoot.privateKey,
    publishedAt,
    catalog: {
      displayName: "Weather",
      summary: "A signed local Registry fixture.",
      documentationUrl: "https://docs.example.test/weather",
    },
    publisherProfile: {
      displayName: "Example Studio",
      websiteUrl: "https://example.test",
    },
  });

  const first = await publish(sourceDirectory, "2026-07-23T00:00:00.000Z");
  const second = await publish(secondSource, "2026-07-23T00:01:00.000Z");
  assert.equal(first.plugin.version, "1.2.3");
  assert.equal(second.plugin.version, "1.2.4");
  const report = await inspectLocalRegistry(registryDirectory);
  assert.equal(report.valid, true);
  assert.deepEqual(report.releases.map((release) => release.version), ["1.2.3", "1.2.4"]);
  assert.deepEqual(report.releases[0].catalog, {
    displayName: "Weather",
    summary: "A signed local Registry fixture.",
    documentationUrl: "https://docs.example.test/weather",
  });
  assert.deepEqual(report.releases[0].publisherProfile, {
    id: "example-studio",
    displayName: "Example Studio",
    websiteUrl: "https://example.test",
  });
  const registryIndex = await readFile(path.join(registryDirectory, "registry.json"), "utf8");
  assert.match(registryIndex, /ed25519:team-root/);
  assert.equal(registryIndex.includes(registryRoot.privateKey), false);
  assert.equal(registryIndex.includes(publisher.privateKey), false);
  await assert.rejects(() => publish(sourceDirectory, "2026-07-23T00:02:00.000Z"), /immutable/i);
});

test("rejects source directories that accidentally include a likely secret", async (t) => {
  const { sourceDirectory } = await makePlugin(t);
  await writeFile(path.join(sourceDirectory, ".env"), "TOKEN=secret", "utf8");
  const inspected = await inspectPluginDirectory(sourceDirectory);
  assert.equal(inspected.valid, false);
  assert.ok(inspected.errors.some((error) => error.includes("potentially secret file")));
});

test("honors literal package files while always retaining signed root metadata", async (t) => {
  const { root, sourceDirectory } = await makePlugin(t);
  const packagePath = path.join(sourceDirectory, "package.json");
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  packageManifest.files = ["dist/manifest.js", "dist/worker.js"];
  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(sourceDirectory, "notes.txt"), "do not publish this source note", "utf8");

  const inspected = await inspectPluginDirectory(sourceDirectory);
  assert.equal(inspected.valid, true);
  assert.deepEqual(inspected.files.map((file) => file.relative).sort(), [
    "dist/manifest.js",
    "dist/worker.js",
    "package.json",
    "sps-plugin.json",
  ]);

  const archive = await packagePluginDirectory({
    sourceDirectory,
    archivePath: path.join(root, "weather.spsplugin"),
  });
  assert.equal(archive.archive.valid, true);
  assert.equal(archive.archive.archive.entryCount, 4);
});

test("rejects package files patterns because signed plugin inputs must stay explicit", async (t) => {
  const { sourceDirectory } = await makePlugin(t);
  const packagePath = path.join(sourceDirectory, "package.json");
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  packageManifest.files = ["dist/*.js"];
  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");

  const inspected = await inspectPluginDirectory(sourceDirectory);
  assert.equal(inspected.valid, false);
  assert.ok(inspected.errors.some((error) => error.includes("safe literal")));
});

test("refuses a release locator that Desktop Registry sources would reject", async (t) => {
  const { root, sourceDirectory } = await makePlugin(t);
  const archivePath = path.join(root, "weather.spsplugin");
  await packagePluginDirectory({ sourceDirectory, archivePath });
  const publisher = generatePluginSigningKeyPair();
  await assert.rejects(
    () => createSignedPluginRelease({
      archivePath,
      artifactUrl: "https://user:password@example.test/weather.spsplugin#mutable",
      publisherId: "example-studio",
      publisherKeyId: "ed25519:example-publisher-1",
      publisherPrivateKey: publisher.privateKey,
    }),
    /Artifact URL/i,
  );
});

test("produces a signed release and Registry index that the Local Registry verifier accepts", async (t) => {
  const { root, sourceDirectory } = await makePlugin(t);
  const archivePath = path.join(root, "weather.spsplugin");
  await packagePluginDirectory({ sourceDirectory, archivePath });
  const publisher = generatePluginSigningKeyPair();
  const release = await createSignedPluginRelease({
    archivePath,
    artifactUrl: "packages/weather.spsplugin",
    publisherId: "example-studio",
    publisherKeyId: "ed25519:example-publisher-1",
    publisherPrivateKey: publisher.privateKey,
    publishedAt: "2026-07-23T00:00:00.000Z",
  });
  assert.equal(release.record.compatibility.extensionProfile, "2.0");
  const registryRoot = path.join(root, "registry");
  const releasePath = "releases/com.example.weather-1.2.3.json";
  await (await import("node:fs/promises")).mkdir(path.join(registryRoot, "releases"), { recursive: true });
  await (await import("node:fs/promises")).mkdir(path.join(registryRoot, "packages"), { recursive: true });
  await copyFile(archivePath, path.join(registryRoot, "packages", "weather.spsplugin"));
  await writeFile(path.join(registryRoot, "releases", "com.example.weather-1.2.3.json"), `${JSON.stringify(release.record)}\n`, "utf8");
  const registryRootKey = generatePluginSigningKeyPair();
  const index = createSignedRegistryIndex({
    registryId: "io.sps.example",
    displayName: "Example Registry",
    publisherKeys: [{ keyId: "ed25519:example-publisher-1", algorithm: "ed25519", publicKey: publisher.publicKey }],
    releaseRecords: [{ releasePath, record: release.record }],
    registryRootKeyId: "ed25519:example-registry-root-1",
    registryRootPrivateKey: registryRootKey.privateKey,
    updatedAt: "2026-07-23T00:00:00.000Z",
  });
  await writeFile(path.join(registryRoot, "registry.json"), `${JSON.stringify(index.index)}\n`, "utf8");

  const report = await inspectLocalRegistry(registryRoot);
  assert.equal(report.valid, true);
  assert.deepEqual(report.releases.map((item) => [item.pluginId, item.version]), [["com.example.weather", "1.2.3"]]);
  assert.equal((await readFile(path.join(registryRoot, "registry.json"), "utf8")).includes("ed25519:example-registry-root-1"), true);
});
