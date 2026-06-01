/**
 * Next.js instrumentation hook. Runs once when the server process starts (both
 * `next dev` and the standalone `next start` server used inside Electron).
 *
 * This is where the desktop build boots its in-process scheduler — the
 * replacement for the old Redis/BullMQ worker. Because the scheduler lives in
 * the same process as the server actions that enqueue work, no broker is needed.
 *
 * Set RUN_INPROCESS_SCHEDULER=0 to disable (e.g. a server deployment that runs
 * the scheduler as a separate `npm run worker` process instead).
 */
export async function register(): Promise<void> {
  // Only run in the Node.js runtime (never the Edge runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_INPROCESS_SCHEDULER === "0") return;

  const { bootScheduler } = await import("@/server/runtime/boot");
  await bootScheduler();
}
