/**
 * Standalone scheduler process. Run with: npm run worker
 *
 * In the desktop build the in-process scheduler normally runs *inside* the
 * Next.js server (see src/instrumentation.ts), so this separate process is NOT
 * needed for the Electron app.
 *
 * It exists for server deployments that prefer to run scheduling in its own
 * process: set RUN_INPROCESS_SCHEDULER=0 on the web server (so it doesn't also
 * schedule) and run this worker against the same database. Running both the
 * embedded scheduler AND this worker against one database would double-publish.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { getScheduler } from "@/lib/scheduler";
import { bootScheduler } from "@/server/runtime/boot";

async function main(): Promise<void> {
  await bootScheduler();
  console.log("Worker started: in-process scheduler is watching for scheduled publishes.");
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  console.log("Shutting down worker…");
  getScheduler().stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
