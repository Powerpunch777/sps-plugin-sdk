#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createPluginTemplate,
  createSignedPluginRelease,
  createSignedRegistryIndex,
  generatePluginSigningKeyPair,
  inspectPluginDirectory,
  packagePluginDirectory,
  publishPluginToLocalRegistry,
} from "../authoring/plugin-package-v1.mjs";
import { inspectPluginArchive } from "../registry/archive-inspector-v1.mjs";
import { inspectLocalRegistry } from "../registry/local-registry-v1.mjs";

function usage() {
  return `SPS Plugin Kit

Commands:
  sps-plugin init <directory> --id <plugin-id> --package <package-name> [--name <display-name>] [--version <semver>]
  sps-plugin validate <directory>
  sps-plugin inspect <plugin-directory|registry-directory|plugin.spsplugin>
  sps-plugin pack <directory> --out <plugin.spsplugin> [--overwrite]
  sps-plugin keygen --private <publisher-private.pem> --public <publisher-public.pem>
  sps-plugin release <plugin.spsplugin> --artifact-url <relative-or-https-url> --publisher-id <id> --publisher-key-id <ed25519:id> --private-key <pem> --out <release.json> [--catalog-name <name>] [--summary <text>] [--docs-url <https-url>]
  sps-plugin registry-index --registry-id <id> --display-name <name> --root-key-id <ed25519:id> --root-private-key <pem> --publisher-key <key-id=public.pem> --release <release-path=release.json> --out <registry.json>
  sps-plugin publish-local <plugin-directory> --registry <directory> --registry-id <id> --display-name <name> --publisher-id <id> --publisher-key-id <ed25519:id> --publisher-private-key <pem> --root-key-id <ed25519:id> --root-private-key <pem> [--catalog-name <name>] [--summary <text>] [--docs-url <https-url>] [--publisher-name <name>] [--publisher-url <https-url>]
`;
}

function parseArguments(values) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === "overwrite") {
      options.set(key, true);
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Option --${key} needs a value.`);
    const current = options.get(key);
    options.set(key, current === undefined ? next : Array.isArray(current) ? [...current, next] : [current, next]);
    index += 1;
  }
  return { positionals, options };
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Option --${name} is required.`);
  return value;
}

function many(options, name) {
  const value = options.get(name);
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

async function readText(filePath) {
  return await fs.readFile(path.resolve(filePath), "utf8");
}

async function writeJson(filePath, value) {
  const output = path.resolve(filePath);
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await fs.writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return output;
}

async function inspectPath(inputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error("inspect requires a plugin directory, Registry directory, or .spsplugin archive path.");
  }
  const target = path.resolve(inputPath);
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch (error) {
    throw new Error(`Inspect target is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (stats.isSymbolicLink()) throw new Error("Inspect target must not be a symbolic link.");
  if (stats.isDirectory()) {
    try {
      const registry = await fs.lstat(path.join(target, "registry.json"));
      if (registry.isSymbolicLink() || !registry.isFile()) throw new Error("registry.json must be a regular file.");
      return { kind: "local-registry", target, report: await inspectLocalRegistry(target) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return { kind: "plugin-source", target, report: await inspectPluginDirectory(target) };
    }
  }
  if (stats.isFile() && target.toLowerCase().endsWith(".spsplugin")) {
    return { kind: "plugin-archive", target, report: await inspectPluginArchive(target) };
  }
  throw new Error("Inspect accepts a plugin source directory, Registry directory, or .spsplugin archive.");
}

function parsePair(value, label) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`${label} must use key=value syntax.`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function catalogFromOptions(options) {
  const catalog = {
    ...(typeof options.get("catalog-name") === "string" ? { displayName: options.get("catalog-name") } : {}),
    ...(typeof options.get("summary") === "string" ? { summary: options.get("summary") } : {}),
    ...(typeof options.get("docs-url") === "string" ? { documentationUrl: options.get("docs-url") } : {}),
  };
  return Object.keys(catalog).length === 0 ? undefined : catalog;
}

function publisherProfileFromOptions(options) {
  const profile = {
    ...(typeof options.get("publisher-name") === "string" ? { displayName: options.get("publisher-name") } : {}),
    ...(typeof options.get("publisher-url") === "string" ? { websiteUrl: options.get("publisher-url") } : {}),
  };
  return Object.keys(profile).length === 0 ? undefined : profile;
}

async function run() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }
  const { positionals, options } = parseArguments(rest);
  if (command === "init") {
    const directory = positionals[0];
    const report = await createPluginTemplate({
      directory,
      pluginId: required(options, "id"),
      packageName: required(options, "package"),
      displayName: options.get("name") || "SPS Plugin",
      version: options.get("version") || "0.1.0",
    });
    if (!report.valid) throw new Error(report.errors.join("\n"));
    console.log(`Created SPS Plugin template: ${report.source.root}`);
    return;
  }
  if (command === "validate") {
    const report = await inspectPluginDirectory(positionals[0]);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
    return;
  }
  if (command === "inspect") {
    const result = await inspectPath(positionals[0]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.report.valid) process.exitCode = 1;
    return;
  }
  if (command === "pack") {
    const result = await packagePluginDirectory({
      sourceDirectory: positionals[0],
      archivePath: required(options, "out"),
      overwrite: options.get("overwrite") === true,
    });
    console.log(`Created verified SPS plugin archive: ${result.archivePath}`);
    return;
  }
  if (command === "keygen") {
    const privateKey = required(options, "private");
    const publicKey = required(options, "public");
    const pair = generatePluginSigningKeyPair();
    await fs.mkdir(path.dirname(path.resolve(privateKey)), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.dirname(path.resolve(publicKey)), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.resolve(privateKey), pair.privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      await fs.writeFile(path.resolve(publicKey), pair.publicKey, { encoding: "utf8", mode: 0o644, flag: "wx" });
    } catch (error) {
      await fs.rm(path.resolve(privateKey), { force: true });
      throw error;
    }
    console.log(`Created Ed25519 key pair. Keep ${path.resolve(privateKey)} private.`);
    return;
  }
  if (command === "release") {
    const release = await createSignedPluginRelease({
      archivePath: positionals[0],
      artifactUrl: required(options, "artifact-url"),
      publisherId: required(options, "publisher-id"),
      publisherKeyId: required(options, "publisher-key-id"),
      publisherPrivateKey: await readText(required(options, "private-key")),
      compatibilitySps: options.get("sps") || ">=0.4.0 <0.5.0",
      visibility: options.get("visibility") || "public",
      catalog: catalogFromOptions(options),
      publisherProfile: publisherProfileFromOptions(options),
    });
    const output = await writeJson(required(options, "out"), release.record);
    console.log(`Created signed release record: ${output}`);
    return;
  }
  if (command === "registry-index") {
    const publisherKeys = await Promise.all(many(options, "publisher-key").map(async (entry) => {
      const [keyId, filePath] = parsePair(entry, "--publisher-key");
      return { keyId, algorithm: "ed25519", publicKey: await readText(filePath) };
    }));
    const releaseRecords = await Promise.all(many(options, "release").map(async (entry) => {
      const [releasePath, recordPath] = parsePair(entry, "--release");
      return { releasePath, record: JSON.parse(await readText(recordPath)) };
    }));
    const result = createSignedRegistryIndex({
      registryId: required(options, "registry-id"),
      displayName: required(options, "display-name"),
      publisherKeys,
      releaseRecords,
      registryRootKeyId: required(options, "root-key-id"),
      registryRootPrivateKey: await readText(required(options, "root-private-key")),
    });
    const output = await writeJson(required(options, "out"), result.index);
    console.log(`Created signed Registry index: ${output}`);
    return;
  }
  if (command === "publish-local") {
    const registryRootKeyId = required(options, "root-key-id");
    const published = await publishPluginToLocalRegistry({
      sourceDirectory: positionals[0],
      registryDirectory: required(options, "registry"),
      registryId: required(options, "registry-id"),
      displayName: required(options, "display-name"),
      publisherId: required(options, "publisher-id"),
      publisherKeyId: required(options, "publisher-key-id"),
      publisherPrivateKey: await readText(required(options, "publisher-private-key")),
      registryRootKeyId,
      registryRootPrivateKey: await readText(required(options, "root-private-key")),
      compatibilitySps: options.get("sps") || ">=0.4.0 <0.5.0",
      visibility: options.get("visibility") || "public",
      catalog: catalogFromOptions(options),
      publisherProfile: publisherProfileFromOptions(options),
    });
    console.log(JSON.stringify({
      plugin: published.plugin,
      registry: {
        root: published.registryRoot,
        rootKeyId: registryRootKeyId,
        rootPublicKey: published.registryPublicKey,
      },
    }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
