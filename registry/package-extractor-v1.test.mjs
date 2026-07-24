import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yazl from "yazl";
import { extractPluginArchive } from "./package-extractor-v1.mjs";
import { calculateStaticCapabilitiesDigest } from "./static-package-manifest-v1.mjs";

async function writeZip(destination, entries) {
  await new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const output = createWriteStream(destination);
    output.once("close", resolve);
    output.once("error", reject);
    archive.outputStream.once("error", reject).pipe(output);
    for (const entry of entries) {
      archive.addBuffer(Buffer.from(entry.contents ?? "", "utf8"), entry.name, entry.options);
    }
    archive.end();
  });
}

async function makeFixture(t, entries) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-plugin-extract-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archivePath = path.join(root, "example.spsplugin");
  await writeZip(archivePath, entries);
  const contents = await fs.readFile(archivePath);
  return {
    archivePath,
    destinationRoot: path.join(root, "staging"),
    expectedArtifact: { sha256: createHash("sha256").update(contents).digest("hex"), sizeBytes: contents.length },
  };
}

const runtimeManifestContents = "export default {};";
const staticCapabilities = ["agent.tools.register"];
const validEntries = [
  { name: "package.json", contents: JSON.stringify({ name: "@example/weather", version: "1.2.3" }) },
  { name: "sps-plugin.json", contents: JSON.stringify({
    schemaVersion: 1,
    plugin: { id: "com.example.weather", version: "1.2.3", apiVersion: "1" },
    runtime: {
      manifestEntry: "dist/manifest.js",
      manifestSha256: createHash("sha256").update(runtimeManifestContents).digest("hex"),
    },
    capabilities: staticCapabilities,
    permissionsDigest: calculateStaticCapabilitiesDigest(staticCapabilities),
  }) },
  { name: "dist/manifest.js", contents: runtimeManifestContents },
];

test("extracts an inspected plugin into a new staging directory", async (t) => {
  const fixture = await makeFixture(t, validEntries);
  const result = await extractPluginArchive(fixture);

  assert.equal(result.extracted, true);
  assert.deepEqual(result.errors, []);
  assert.equal(await fs.readFile(path.join(fixture.destinationRoot, "dist", "manifest.js"), "utf8"), runtimeManifestContents);
  assert.equal(await fs.readFile(path.join(fixture.destinationRoot, "package.json"), "utf8"), validEntries[0].contents);
});

test("never overwrites an existing staging directory", async (t) => {
  const fixture = await makeFixture(t, validEntries);
  await fs.mkdir(fixture.destinationRoot, { recursive: true });
  await fs.writeFile(path.join(fixture.destinationRoot, "keep.txt"), "keep", "utf8");
  const result = await extractPluginArchive(fixture);

  assert.equal(result.extracted, false);
  assert.ok(result.errors[0].includes("must be new"));
  assert.equal(await fs.readFile(path.join(fixture.destinationRoot, "keep.txt"), "utf8"), "keep");
});

test("does not create a staging directory when inspection rejects the package", async (t) => {
  const fixture = await makeFixture(t, [{ name: "dist/index.js", contents: "export default {};" }]);
  const result = await extractPluginArchive(fixture);

  assert.equal(result.extracted, false);
  await assert.rejects(fs.stat(fixture.destinationRoot));
});

test("refuses an archive whose release hash differs before staging", async (t) => {
  const fixture = await makeFixture(t, validEntries);
  fixture.expectedArtifact.sha256 = "0".repeat(64);
  const result = await extractPluginArchive(fixture);

  assert.equal(result.extracted, false);
  assert.ok(result.errors[0].includes("SHA-256"));
  await assert.rejects(fs.stat(fixture.destinationRoot));
});

test("discards staging when the declared runtime manifest hash does not match", async (t) => {
  const changedEntries = validEntries.map((entry) => ({ ...entry }));
  changedEntries[1] = {
    ...changedEntries[1],
    contents: JSON.stringify({
      ...JSON.parse(changedEntries[1].contents),
      runtime: { manifestEntry: "dist/manifest.js", manifestSha256: "f".repeat(64) },
    }),
  };
  const fixture = await makeFixture(t, changedEntries);
  const result = await extractPluginArchive(fixture);

  assert.equal(result.extracted, false);
  assert.ok(result.errors[0].includes("Static runtime manifest SHA-256"));
  await assert.rejects(fs.stat(fixture.destinationRoot));
});
