import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";

const SOURCE_ENTRY = path.join("src", "worker.mjs");
const DISTRIBUTION_ENTRY = path.join("dist", "worker.js");

async function realPluginRoot(sourceDirectory) {
  const root = await fs.realpath(sourceDirectory);
  const stats = await fs.lstat(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Plugin source root must be a real directory.");
  }
  return root;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertNoSymlinkAncestors(root, target) {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Plugin Worker path must stay inside the plugin source root.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = await fs.lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!stats) return;
    if (stats.isSymbolicLink()) throw new Error(`Plugin Worker path must not use a symbolic link or junction: ${path.relative(root, current)}.`);
  }
}

/**
 * Bundles the fixed public Worker entrypoint for Node without executing plugin
 * code or package scripts. The resulting dist/worker.js contains the bundled SDK,
 * so .spsplugin archives remain runnable after node_modules is excluded.
 */
export async function buildPluginWorker({ sourceDirectory } = {}) {
  if (typeof sourceDirectory !== "string" || sourceDirectory.trim().length === 0) {
    throw new Error("Plugin source directory is required.");
  }
  const root = await realPluginRoot(sourceDirectory);
  const entryPoint = path.join(root, SOURCE_ENTRY);
  await assertNoSymlinkAncestors(root, path.dirname(entryPoint));
  const entryStats = await fs.lstat(entryPoint).catch(() => null);
  if (!entryStats?.isFile() || entryStats.isSymbolicLink()) {
    throw new Error(`Plugin Worker source must be a regular ${SOURCE_ENTRY.replaceAll(path.sep, "/")} file.`);
  }
  const realEntryPoint = await fs.realpath(entryPoint);
  if (!isInside(root, realEntryPoint)) throw new Error("Plugin Worker source must resolve inside the plugin source root.");

  const outputPath = path.join(root, DISTRIBUTION_ENTRY);
  await assertNoSymlinkAncestors(root, path.dirname(outputPath));
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await assertNoSymlinkAncestors(root, path.dirname(outputPath));
  const outputStats = await fs.lstat(outputPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (outputStats?.isSymbolicLink() || (outputStats && !outputStats.isFile())) {
    throw new Error("Plugin Worker output must be a regular file.");
  }
  const temporary = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const result = await build({
      absWorkingDir: root,
      entryPoints: [entryPoint],
      outfile: temporary,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      packages: "bundle",
      legalComments: "none",
      logLevel: "silent",
      write: false,
    });
    const output = result.outputFiles?.find((file) => path.resolve(file.path) === path.resolve(temporary));
    if (!output) throw new Error("Worker bundler did not produce the expected output.");
    await fs.writeFile(temporary, output.contents, { mode: 0o644, flag: "wx" });
    await fs.rm(outputPath, { force: true });
    await fs.rename(temporary, outputPath);
    return { sourceDirectory: root, entryPoint, outputPath, bytes: output.contents.length };
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
