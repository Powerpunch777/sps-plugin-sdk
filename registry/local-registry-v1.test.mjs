import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectLocalRegistry } from "./local-registry-v1.mjs";
import { canonicalizeReleaseRecord } from "./release-record-v1.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publisherPublicKey = publicKey.export({ type: "spki", format: "pem" });

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function makeRecord(content, overrides = {}) {
  const record = {
    registrySchemaVersion: 1,
    plugin: { id: "com.example.weather", version: "1.0.0" },
    artifact: {
      url: "packages/com.example.weather-1.0.0.spsplugin",
      sha256: sha256(content),
      sizeBytes: content.length,
    },
    publisher: { id: "example-studio", keyId: "ed25519:example-1" },
    signature: { algorithm: "ed25519", value: "pending" },
    compatibility: { sps: ">=0.1.0 <1.0.0", pluginApi: 1 },
    visibility: "public",
    permissionsDigest: "b".repeat(64),
    publishedAt: "2026-07-23T00:00:00.000Z",
    ...overrides,
  };
  record.signature.value = sign(null, Buffer.from(canonicalizeReleaseRecord(record)), privateKey).toString("base64");
  return record;
}

async function makeRegistry(t, { recordOverride, indexOverride } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sps-registry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = Buffer.from("SPS plugin fixture", "utf8");
  const record = makeRecord(content, recordOverride);
  const index = {
    registrySchemaVersion: 1,
    registryId: "io.sps.example",
    displayName: "Example Registry",
    updatedAt: "2026-07-23T00:00:00.000Z",
    publisherKeys: [{ keyId: "ed25519:example-1", algorithm: "ed25519", publicKey: publisherPublicKey }],
    plugins: [{ id: "com.example.weather", latest: "1.0.0", releases: ["releases/com.example.weather-1.0.0.json"] }],
    ...indexOverride,
  };
  await fs.mkdir(path.join(root, "packages"), { recursive: true });
  await fs.mkdir(path.join(root, "releases"), { recursive: true });
  await fs.writeFile(path.join(root, "packages", "com.example.weather-1.0.0.spsplugin"), content);
  await fs.writeFile(path.join(root, "releases", "com.example.weather-1.0.0.json"), JSON.stringify(record));
  await fs.writeFile(path.join(root, "registry.json"), JSON.stringify(index));
  return root;
}

test("inspects a signed local Registry release without executing it", async (t) => {
  const root = await makeRegistry(t);
  const report = await inspectLocalRegistry(root);

  assert.deepEqual(report, {
    valid: true,
    errors: [],
    releases: [{
      pluginId: "com.example.weather",
      version: "1.0.0",
      visibility: "public",
      releaseRelativePath: "releases/com.example.weather-1.0.0.json",
      artifactRelativePath: "packages/com.example.weather-1.0.0.spsplugin",
      artifactSha256: sha256(Buffer.from("SPS plugin fixture", "utf8")),
      artifactSizeBytes: Buffer.byteLength("SPS plugin fixture", "utf8"),
      permissionsDigest: "b".repeat(64),
      publisherId: "example-studio",
      publisherKeyId: "ed25519:example-1",
    }],
  });
});

test("rejects an artifact that differs from its signed release record", async (t) => {
  const root = await makeRegistry(t);
  await fs.writeFile(path.join(root, "packages", "com.example.weather-1.0.0.spsplugin"), "tampered");

  const report = await inspectLocalRegistry(root);

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((message) => message.includes("artifact size does not match") || message.includes("artifact SHA-256 does not match")));
});

test("rejects a Registry entry that escapes its root", async (t) => {
  const root = await makeRegistry(t, {
    indexOverride: {
      plugins: [{ id: "com.example.weather", latest: "1.0.0", releases: ["../outside.json"] }],
    },
  });

  const report = await inspectLocalRegistry(root);

  assert.equal(report.valid, false);
  assert.ok(report.errors.includes("Registry release paths must be safe relative JSON paths."));
});

test("rejects a release whose publisher key is not declared by the Registry", async (t) => {
  const root = await makeRegistry(t, { indexOverride: { publisherKeys: [] } });
  const report = await inspectLocalRegistry(root);

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((message) => message.includes("publisher key ed25519:example-1 is not in the registry index")));
});

test("rejects an index latest version that has no verified release", async (t) => {
  const root = await makeRegistry(t, {
    indexOverride: {
      plugins: [{ id: "com.example.weather", latest: "1.0.1", releases: ["releases/com.example.weather-1.0.0.json"] }],
    },
  });
  const report = await inspectLocalRegistry(root);

  assert.equal(report.valid, false);
  assert.ok(report.errors.includes("com.example.weather: latest version 1.0.1 has no verified release record."));
});
