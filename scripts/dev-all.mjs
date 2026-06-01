// Run the web app for local development. The background scheduler now runs
// IN-PROCESS inside the Next.js server (see src/instrumentation.ts), so there is
// no separate worker to launch here — running one alongside the embedded
// scheduler would double-publish. Kept as a script for compatibility with docs.
// Cross-platform (uses shell: true so `npm` resolves to npm.cmd on Windows).
// Ctrl+C stops it.
import { spawn } from "node:child_process";

const targets = [{ name: "web", args: ["run", "dev"] }];

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
