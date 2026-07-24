import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalizeRegistryIndex } from "./release-record-v1.mjs";
import { validateRegistrySource, verifyRegistryIndexForSource } from "./source-trust-v1.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const rootPublicKey = publicKey.export({ type: "spki", format: "pem" });

function makeIndex() {
  const index = {
    registrySchemaVersion: 1,
    registryId: "io.sps.example",
    displayName: "Example Registry",
    updatedAt: "2026-07-23T00:00:00.000Z",
    publisherKeys: [],
    plugins: [{ id: "com.example.weather", latest: "1.0.0", releases: ["releases/com.example.weather-1.0.0.json"] }],
    signature: { keyId: "ed25519:registry-root-1", algorithm: "ed25519", value: "pending" },
  };
  index.signature.value = sign(null, Buffer.from(canonicalizeRegistryIndex(index)), privateKey).toString("base64");
  return index;
}

test("accepts a local source only as explicit Owner trust", () => {
  const source = {
    id: "example.local",
    kind: "local",
    displayName: "Example local Registry",
    localPath: "C:/SPS/Registry",
  };

  assert.deepEqual(validateRegistrySource(source), { valid: true, errors: [] });
  assert.deepEqual(verifyRegistryIndexForSource(source, makeIndex()), {
    valid: true,
    errors: [],
    trust: "explicit-local-owner-trust",
    warning: "Local Registry indexes are trusted only because the Owner explicitly selected this folder.",
  });
});

test("requires HTTPS and a pinned root for remote sources", () => {
  const invalidSource = {
    id: "example.git",
    kind: "git",
    displayName: "Example Registry",
    indexUrl: "http://registry.example.test/registry.json",
  };

  const result = validateRegistrySource(invalidSource);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("HTTPS")));
  assert.ok(result.errors.some((error) => error.includes("trustedRoot")));
});

test("accepts a remote index only when its key ID and root signature match", () => {
  const source = {
    id: "example.official",
    kind: "official",
    displayName: "Example official Registry",
    indexUrl: "https://registry.example.test/registry.json",
    trustedRoot: { keyId: "ed25519:registry-root-1", publicKey: rootPublicKey },
  };

  assert.deepEqual(verifyRegistryIndexForSource(source, makeIndex()), {
    valid: true,
    errors: [],
    trust: "pinned-remote-root",
    warning: null,
  });

  const wrongKeyId = { ...source, trustedRoot: { ...source.trustedRoot, keyId: "ed25519:other-root" } };
  assert.deepEqual(verifyRegistryIndexForSource(wrongKeyId, makeIndex()), {
    valid: false,
    errors: ["Registry index signature keyId does not match the trusted root."],
  });
});
