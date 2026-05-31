// Run the web app and the background worker together in one terminal.
// Cross-platform (uses shell: true so `npm` resolves to npm.cmd on Windows).
// Ctrl+C stops both.
import { spawn } from "node:child_process";

const targets = [
  { name: "web", args: ["run", "dev"] },
  { name: "worker", args: ["run", "worker"] },
];

const children = targets.map((t) => {
  const child = spawn("npm", t.args, { stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    console.log(`\n[${t.name}] exited (code ${code ?? 0}); stopping the rest.`);
    shutdown(code ?? 0);
  });
  return child;
});

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
