// Electron main process for Social Autopilot (desktop build).
//
// Responsibilities:
//   1. Resolve the per-user SQLite database + token key (electron/db.cjs).
//   2. Sync the schema (prisma db push) before anything connects.
//   3. Launch the Next.js standalone server as a child process, running it with
//      Electron's bundled Node (ELECTRON_RUN_AS_NODE) so end users need no Node
//      install. The in-process scheduler boots inside that server via
//      src/instrumentation.ts — no Redis/BullMQ.
//   4. Open a window pointing at the local server and manage app lifecycle.
const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const {
  appResource,
  getDatabaseUrl,
  getOrCreateEncryptionKey,
  ensureDatabase,
} = require("./db.cjs");

// Fixed loopback port for the embedded server. Override with DESKTOP_PORT.
const PORT = Number(process.env.DESKTOP_PORT || 38473);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
// In dev we attach to a separately-run `next dev` (npm run dev) on this URL.
const DEV_URL = process.env.DESKTOP_DEV_URL || "http://localhost:3000";

let serverProcess = null;
let mainWindow = null;

/** Environment shared by the schema sync and the server child process. */
function buildServerEnv() {
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    HOSTNAME: HOST,
    DATABASE_URL: getDatabaseUrl(),
    TOKEN_ENCRYPTION_KEY: getOrCreateEncryptionKey(),
    // Offline-by-default so the app is useful with no API keys (see README).
    LLM_PROVIDER: process.env.LLM_PROVIDER || "mock",
    APP_BASE_URL: BASE_URL,
    REVIEW_TIMEZONE: process.env.REVIEW_TIMEZONE || "Europe/Oslo",
    POSTING_SLOT_HOURS: process.env.POSTING_SLOT_HOURS || "9,13,17",
    // The scheduler runs inside this single server process.
    RUN_INPROCESS_SCHEDULER: "1",
  };
}

/** Launch the Next standalone server (production only). */
function startServer(env) {
  const serverJs = appResource(".next", "standalone", "server.js");
  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: appResource(".next", "standalone"),
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  serverProcess.on("exit", (code) => {
    console.error(`[server] exited with code ${code}.`);
    serverProcess = null;
  });
}

/** Resolve once the server answers an HTTP request (or reject after timeout). */
function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Server did not start within ${timeoutMs}ms at ${url}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0b0c",
    title: "Social Autopilot",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open target=_blank / external links in the user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  void mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot() {
  if (app.isPackaged) {
    const env = buildServerEnv();
    try {
      ensureDatabase(env);
      startServer(env);
      await waitForServer(BASE_URL);
      createWindow(BASE_URL);
    } catch (err) {
      dialog.showErrorBox(
        "Social Autopilot failed to start",
        err instanceof Error ? err.message : String(err),
      );
      app.quit();
    }
  } else {
    // Development: `npm run dev` (or `npm run desktop:dev`) serves the app and
    // the embedded scheduler; Electron just opens a window onto it.
    try {
      await waitForServer(DEV_URL, 60_000);
    } catch {
      console.warn(`[dev] ${DEV_URL} not reachable yet; loading anyway.`);
    }
    createWindow(DEV_URL);
  }
}

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
    void boot();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function shutdown() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.on("before-quit", shutdown);
process.on("exit", shutdown);
