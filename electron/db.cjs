// Database + secrets bootstrap for the desktop app.
//
// The SQLite database lives in Electron's per-user `userData` directory, so each
// installation gets its own private store that survives app updates. The schema
// is applied with `prisma db push` (no migration files required) against the
// SQLite schema. The token-encryption key is generated once and persisted there
// too, so OAuth tokens stay decryptable across restarts.
const { app } = require("electron");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

/**
 * Resolve a path that differs between dev and packaged builds. In a packaged
 * app, the assembled Next standalone server (plus prisma schema + the Prisma
 * CLI/engines) is copied under `resources/app` (see electron-builder.yml).
 */
function appResource(...segments) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..");
  return path.join(base, ...segments);
}

/** Absolute path to this installation's SQLite database file. */
function getDbPath() {
  return path.join(app.getPath("userData"), "social-autopilot.db");
}

/** The Prisma datasource URL for the local SQLite file. */
function getDatabaseUrl() {
  // Forward slashes work on every platform for SQLite file URLs.
  return `file:${getDbPath().replace(/\\/g, "/")}`;
}

/**
 * Read (or lazily create) the 32-byte base64 token-encryption key used by
 * src/server/crypto.ts. Stored in userData so it is stable per installation.
 */
function getOrCreateEncryptionKey() {
  const keyPath = path.join(app.getPath("userData"), "token-encryption.key");
  try {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath, "utf8").trim();
      if (existing) return existing;
    }
  } catch {
    /* fall through to regenerate */
  }
  const key = randomBytes(32).toString("base64");
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

/**
 * Create / sync the SQLite schema before the server starts. Uses `prisma db
 * push` (idempotent, no migration files needed) via the bundled Prisma CLI,
 * run with the app's own Node runtime (ELECTRON_RUN_AS_NODE).
 */
function ensureDatabase(env) {
  const schema = appResource("prisma", "schema.sqlite.prisma");
  const prismaCli = appResource("node_modules", "prisma", "build", "index.js");

  if (!fs.existsSync(prismaCli)) {
    console.warn(
      `[db] Prisma CLI not found at ${prismaCli}. Skipping schema sync — ` +
        `run "npm run db:push" during development, or ensure prisma is bundled.`,
    );
    return;
  }

  console.log(`[db] Syncing SQLite schema -> ${getDbPath()}`);
  const result = spawnSync(
    process.execPath,
    [prismaCli, "db", "push", "--schema", schema, "--skip-generate", "--accept-data-loss"],
    {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    console.error(`[db] "prisma db push" exited with code ${result.status}.`);
  }
}

module.exports = {
  appResource,
  getDbPath,
  getDatabaseUrl,
  getOrCreateEncryptionKey,
  ensureDatabase,
};
