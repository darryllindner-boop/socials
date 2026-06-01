// Developer convenience: run the Next dev server (with the embedded in-process
// scheduler) and launch Electron pointed at it. Ctrl+C stops both.
//
// Electron waits for http://localhost:3000 itself (see electron/main.cjs), so we
// just start both processes and tie their lifecycles together.
import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function start(name, command, args) {
  const child = spawn(command, args, { stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    console.log(`\n[${name}] exited (code ${code ?? 0}); stopping the rest.`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}

start("next", "npm", ["run", "dev"]);
start("electron", "npx", ["electron", "."]);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
