import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.env.CI === "1") {
  process.env.CI = "true";
}

const args = process.argv.slice(2);
const isWindows = process.platform === "win32";
const tauriBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.bin",
  isWindows ? "tauri.cmd" : "tauri"
);

const child = spawn(tauriBin, args, {
  stdio: "inherit",
  shell: isWindows,
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
