import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("Choose dev or start.");
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const children = [
  spawn(process.execPath, mode === "dev" ? ["--watch", "--import", "tsx", "src/server.ts"] : ["dist/server.js"], {cwd: path.join(root,"backend"), stdio: "inherit"}),
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode, "--hostname", "127.0.0.1", "--port", "3000"], {cwd: path.join(root,"frontend"), stdio: "inherit"})
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve))))
    .then(() => process.exit(code));
  setTimeout(() => process.exit(code), 5000).unref();
}
for (const child of children) {
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 0); });
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
