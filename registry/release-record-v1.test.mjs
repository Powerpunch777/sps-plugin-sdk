import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  calculateReleaseCapabilitiesDigest,
  canonicalizeJson,
  canonicalizeRegistryIndex,
  canonicalizeReleaseRecord,
  isSafeRegistryRelativePath,
  validateRegistryIndex,
  validateRegistryPublisherProfile,
  validateReleaseRecord,
  verifyRegistryIndexSignature,
  verifyReleaseRecordSignature,
} from "./release-record-v1.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: registryRootPrivateKey, publicKey: registryRootPublicKey } = generateKeyPairSync("ed25519");
const publisherPublicKey = publicKey.export({ type: "spki", format: "pem" });
const registryRootPublicKeyPem = registryRootPublicKey.export({ type: "spki", format: "pem" });

function makeRecord(overrides = {}) {
  const record = {
    registrySchemaVersion: 1,
    plugin: { id: "com.example.weather", version: "1.0.0" },
    artifact: {
      url: "releases/com.example.weather-1.0.0.spsplugin",
      sha256: "a".repeat(64),
      sizeBytes: 2048,
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

test("validates and verifies a signed immutable release record", () => {
  const record = makeRecord();

  assert.deepEqual(validateReleaseRecord(record), { valid: true, errors: [] });
  assert.deepEqual(verifyReleaseRecordSignature(record, publisherPublicKey), { valid: true, errors: [] });
});

test("rejects a release record when a signed field changes", () => {
  const record = makeRecord();
  record.artifact.sha256 = "c".repeat(64);

  assert.deepEqual(verifyReleaseRecordSignature(record, publisherPublicKey), {
    valid: false,
    errors: ["Release record signature does not match the publisher key."],
  });
});

test("signs optional Marketplace catalog metadata without changing installation authority", () => {
  const record = makeRecord({
    catalog: {
      displayName: "Example Weather",
      summary: "Adds a read-only weather summary to a team dashboard.",
      documentationUrl: "https://docs.example.test/plugins/weather",
    },
  });

  assert.deepEqual(validateReleaseRecord(record), { valid: true, errors: [] });
  assert.deepEqual(verifyReleaseRecordSignature(record, publisherPublicKey), { valid: true, errors: [] });
  record.catalog.summary = "Changed after signing.";
  assert.deepEqual(verifyReleaseRecordSignature(record, publisherPublicKey), {
    valid: false,
    errors: ["Release record signature does not match the publisher key."],
  });
});

test("rejects unsafe or unstructured Marketplace catalog metadata", () => {
  const unsafeUrl = validateReleaseRecord(makeRecord({
    catalog: { documentationUrl: "https://user:password@example.test/docs#fragment" },
  }));
  const unknownField = validateReleaseRecord(makeRecord({
    catalog: { displayName: "Weather", price: "free" },
  }));
  const emptyCatalog = validateReleaseRecord(makeRecord({ catalog: {} }));

  assert.equal(unsafeUrl.valid, false);
  assert.ok(unsafeUrl.errors.includes("catalog.documentationUrl must be an HTTPS URL without credentials or a fragment."));
  assert.equal(unknownField.valid, false);
  assert.ok(unknownField.errors.includes("catalog contains an unsupported field."));
  assert.equal(emptyCatalog.valid, false);
  assert.ok(emptyCatalog.errors.includes("catalog must contain at least one supported field."));
});

test("binds an optional release capability preview to the signed permissions digest", () => {
  const capabilities = ["plugin.state.read", "ui.page.register"];
  const record = makeRecord({
    capabilities,
    permissionsDigest: calculateReleaseCapabilitiesDigest(capabilities),
  });

  assert.deepEqual(validateReleaseRecord(record), { valid: true, errors: [] });
  assert.deepEqual(verifyReleaseRecordSignature(record, publisherPublicKey), { valid: true, errors: [] });
  const mismatched = makeRecord({
    capabilities,
    permissionsDigest: "b".repeat(64),
  });
  assert.equal(validateReleaseRecord(mismatched).valid, false);
  assert.ok(validateReleaseRecord(mismatched).errors.includes("permissionsDigest does not match release capabilities."));
});

test("validates Registry-root-signed publisher profiles separately from plugin permissions", () => {
  const valid = validateRegistryPublisherProfile({
    id: "example-studio",
    displayName: "Example Studio",
    websiteUrl: "https://example.test",
  });
  const unsafe = validateRegistryPublisherProfile({
    id: "example-studio",
    displayName: "Example Studio",
    websiteUrl: "https://user:password@example.test/#fragment",
  });
  const unknown = validateRegistryPublisherProfile({
    id: "example-studio",
    displayName: "Example Studio",
    verified: true,
  });

  assert.deepEqual(valid, { valid: true, errors: [] });
  assert.equal(unsafe.valid, false);
  assert.ok(unsafe.errors.includes("Registry publisher profile websiteUrl must be an HTTPS URL without credentials or a fragment."));
  assert.equal(unknown.valid, false);
  assert.ok(unknown.errors.includes("Registry publisher profile contains an unsupported field."));
});

test("rejects paid releases before the entitlement contract exists", () => {
  const result = validateReleaseRecord(makeRecord({ visibility: "paid" }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("visibility must be public, unlisted, or private."));
});

test("rejects malformed signatures and non-ISO publish times", () => {
  const malformedSignature = makeRecord();
  malformedSignature.signature.value = "not-base64%";
  const malformedDate = makeRecord({ publishedAt: "2026-07-23" });

  assert.equal(validateReleaseRecord(malformedSignature).valid, false);
  assert.equal(validateReleaseRecord(malformedDate).valid, false);
});

test("rejects unsafe artifact and release paths", () => {
  const releaseResult = validateReleaseRecord(makeRecord({ artifact: {
    url: "../plugin.spsplugin",
    sha256: "a".repeat(64),
    sizeBytes: 2048,
  } }));
  const indexResult = validateRegistryIndex({
    registrySchemaVersion: 1,
    registryId: "io.sps.example",
    displayName: "Example",
    updatedAt: "2026-07-23T00:00:00.000Z",
    publisherKeys: [{ keyId: "ed25519:example-1", algorithm: "ed25519", publicKey: publisherPublicKey }],
    plugins: [{ id: "com.example.weather", latest: "1.0.0", releases: ["../release.json"] }],
  });

  assert.equal(releaseResult.valid, false);
  assert.equal(indexResult.valid, false);
});

test("does not confuse URL-like text with a Registry relative path", () => {
  assert.equal(isSafeRegistryRelativePath("https://user:password@example.test/plugin.spsplugin#mutable"), false);
  assert.equal(isSafeRegistryRelativePath("releases//plugin.json"), false);
  assert.equal(isSafeRegistryRelativePath("releases/./plugin.json"), false);
});

test("canonical JSON is independent of object key order", () => {
  assert.equal(canonicalizeJson({ b: [2, 1], a: { z: true, y: null } }), canonicalizeJson({ a: { y: null, z: true }, b: [2, 1] }));
});

test("verifies a signed Registry index with a trusted root key", () => {
  const index = {
    registrySchemaVersion: 1,
    registryId: "io.sps.example",
    displayName: "Example Registry",
    updatedAt: "2026-07-23T00:00:00.000Z",
    publisherKeys: [{ keyId: "ed25519:example-1", algorithm: "ed25519", publicKey: publisherPublicKey }],
    publishers: [{ id: "example-studio", displayName: "Example Studio", websiteUrl: "https://example.test" }],
    plugins: [{ id: "com.example.weather", latest: "1.0.0", releases: ["releases/com.example.weather-1.0.0.json"] }],
    signature: { keyId: "ed25519:registry-root-1", algorithm: "ed25519", value: "pending" },
  };
  index.signature.value = sign(null, Buffer.from(canonicalizeRegistryIndex(index)), registryRootPrivateKey).toString("base64");

  assert.deepEqual(verifyRegistryIndexSignature(index, {
    keyId: "ed25519:registry-root-1",
    publicKey: registryRootPublicKeyPem,
  }), { valid: true, errors: [] });
  assert.deepEqual(verifyRegistryIndexSignature(index, {
    keyId: "ed25519:another-root",
    publicKey: registryRootPublicKeyPem,
  }), {
    valid: false,
    errors: ["Registry index signature keyId does not match the trusted root."],
  });
  index.plugins[0].latest = "1.0.1";
  assert.deepEqual(verifyRegistryIndexSignature(index, {
    keyId: "ed25519:registry-root-1",
    publicKey: registryRootPublicKeyPem,
  }), {
    valid: false,
    errors: ["Registry index signature does not match the trusted root key."],
  });
});

test("fails closed for an unusable publisher public key", () => {
  const record = makeRecord();

  assert.deepEqual(verifyReleaseRecordSignature(record, "not a public key"), {
    valid: false,
    errors: ["Release record signature does not match the publisher key."],
  });
});
