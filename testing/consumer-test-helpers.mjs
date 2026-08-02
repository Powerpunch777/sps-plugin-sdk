import { execFile } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function runConsumerCommand(command, args, cwd) {
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const executable = command === "npm" ? process.execPath : command;
  const executableArgs = command === "npm" ? [npmCli, ...args] : args;
  const child = execFile(executable, executableArgs, {
    cwd,
    windowsHide: true,
    env: { ...process.env, npm_config_cache: path.join(cwd, ".npm-cache") },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

export async function extractTarGz(tarball, destination, cwd) {
  await fs.mkdir(destination, { recursive: true });
  const tarCommand = process.platform === "win32" ? "tar.exe" : "tar";
  await runConsumerCommand(tarCommand, ["-xzf", tarball, "-C", destination], cwd);
}
