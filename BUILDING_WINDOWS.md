# Building the Windows desktop app

This branch (`desktop-app`) packages Social Autopilot as a self-contained
**Windows desktop application**. It swaps the server-oriented infrastructure for
a single-process, single-user stack:

| Concern | Web variant (`main`) | Desktop variant (this branch) |
| --- | --- | --- |
| Database | PostgreSQL via Prisma | **SQLite** via Prisma (file in user-data dir) |
| Scheduling / queue | Redis + BullMQ + worker | **In-process scheduler** (timers + DB poller) |
| Shell | Browser → Next.js server | **Electron** window → embedded Next.js server |
| Distribution | Docker / Node | **electron-builder** NSIS installer (`.exe`) |

No Redis, no separate worker, no Docker, and **no Node.js install required on the
end user's machine** — the app runs the bundled Next.js server with Electron's
own Node runtime.

---

## How it fits together

```
 Electron main (electron/main.cjs)
   │  1. resolve SQLite path + token key in %APPDATA% (electron/db.cjs)
   │  2. prisma db push  → create/sync the schema
   │  3. spawn  .next/standalone/server.js  (ELECTRON_RUN_AS_NODE)
   │        └─ src/instrumentation.ts → boots the in-process scheduler
   │  4. open a BrowserWindow on http://127.0.0.1:38473
   ▼
 Next.js server (one process)
   ├─ UI + server actions  (generate → review → schedule)
   └─ InProcessScheduler (src/lib/scheduler.ts)
        ├─ timer per scheduled publish / metrics pull
        └─ 30s safety-net poller re-discovers due work from SQLite
```

The database is the source of truth for the schedule: on startup the scheduler
re-hydrates timers from every `scheduled` variant, and the poller catches
anything a lost timer would have missed (restarts, long delays, etc.).

---

## Prerequisites (developer machine)

- **Windows 10/11** to produce a Windows installer (electron-builder builds the
  NSIS target natively on Windows; cross-building from macOS/Linux is possible
  but Wine-dependent and not covered here).
- **Node.js 20+** and npm.
- Internet access for `npm install` (pulls Next, Prisma, Electron, etc.).

---

## 1. Install & generate

```bash
npm install
npm run db:generate          # prisma generate (uses prisma/schema.sqlite.prisma)
```

`prisma generate` reads the schema configured in `package.json` →
`prisma.schema = "prisma/schema.sqlite.prisma"`, so all `db:*` commands target
SQLite by default.

## 2. Run in development

```bash
npm run desktop:dev
```

This starts `next dev` (with the embedded scheduler) and opens an Electron
window pointed at `http://localhost:3000`. You can also just run `npm run dev`
and use a browser.

For a throwaway local DB while developing in the browser:

```bash
npm run db:push              # create prisma/dev.db from the SQLite schema
npm run db:seed              # optional: demo brand + drafts (offline mock LLM)
npm run dev
```

## 3. Build the installer

```bash
npm run desktop:dist
```

Which runs, in order:

1. `npm run build` → `prisma generate` + `next build` (emits
   `.next/standalone/server.js` because `next.config.mjs` sets
   `output: "standalone"`).
2. `npm run desktop:assemble` → `scripts/build-desktop.mjs` collects the
   standalone server, static/public assets, the SQLite schema, and the Prisma
   CLI + engines into `dist-desktop/app/`.
3. `electron-builder --config electron-builder.yml` → produces the NSIS
   installer in `dist-desktop/release/`
   (`Social Autopilot-<version>-Setup.exe`).

Install it like any Windows app. On first launch the app creates its database at:

```
%APPDATA%\Social Autopilot\social-autopilot.db
```

and a `token-encryption.key` beside it (used to encrypt OAuth tokens at rest).

---

## Configuration

The packaged app is self-configuring and runs offline with the deterministic
`mock` LLM, so it is useful with **no API keys**. To override defaults, set
environment variables before launching (or adapt `buildServerEnv()` in
`electron/main.cjs`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `mock` / `openai` / `anthropic` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | — | real-LLM credentials |
| `REVIEW_TIMEZONE` | `Europe/Oslo` | morning-review + posting-slot timezone |
| `POSTING_SLOT_HOURS` | `9,13,17` | daily drip slots |
| `DESKTOP_PORT` | `38473` | loopback port for the embedded server |
| `*_CLIENT_ID` / `*_SECRET` | — | per-platform OAuth apps (live publishing) |

`TOKEN_ENCRYPTION_KEY` is generated and persisted automatically per install.

---

## What changed from the web variant (for reviewers)

- **`prisma/schema.sqlite.prisma`** — SQLite-compatible schema. SQLite has no
  native `enum` or scalar-list types, so:
  - enum columns (`platform`, `status`, `autonomy`) are `String` (the canonical
    value sets still live in `src/core/types.ts`);
  - `String[]` columns (`tags`, `hashtags`, `mediaUrls`) are a single JSON
    `String` (`@default("[]")`);
  - `Json` columns (`voice`, `metadata`, `evalIssues`, `metrics`, `detail`) are
    kept as `Json` (supported on SQLite in Prisma 5+).
- **`src/lib/serialize.ts`** — the boundary that packs/unpacks those JSON lists
  (`packList` / `unpackList`) and re-narrows enum strings (`asPlatform`, etc.).
  It is tolerant of both shapes, so the same code keeps working if pointed back
  at Postgres.
- **`src/lib/scheduler.ts`** — the in-process scheduler (bounded retries with
  backoff, an in-flight guard against double-publishing, long-timeout re-arming
  past the `setTimeout` 24.8-day ceiling, and a DB-backed safety-net poller).
- **`src/lib/queue.ts`** — now a thin shim exposing the original
  `enqueuePublish` / `enqueueMetrics` API on top of the scheduler, so
  `src/server/service.ts` was left untouched.
- **`src/server/runtime/`** — `publish.ts` (the publish/metrics job logic, moved
  out of the old BullMQ worker) and `boot.ts` (wires handlers + hydration).
- **`src/instrumentation.ts`** — Next.js `register()` hook that boots the
  scheduler when the server process starts.
- **`electron/`** — `main.cjs` (lifecycle + server child process + window),
  `db.cjs` (SQLite path, key, `prisma db push`), `preload.cjs` (minimal bridge).
- **`electron-builder.yml`**, **`scripts/build-desktop.mjs`** — packaging.

---

## Known caveats / things to verify on a Windows box

This scaffold was authored in a network-isolated environment where
`npm install`, `prisma generate`, `next build`, and `electron-builder` could not
be executed. The code is internally consistent, but please verify the following
when you first build:

1. **Prisma engine in the standalone bundle.** Next's standalone tracing does
   not always copy the Prisma query engine for externalized packages, so
   `scripts/build-desktop.mjs` copies `node_modules/.prisma` and
   `@prisma/client` into the bundle explicitly. Confirm the
   `libquery_engine-*.node` (Windows: `query_engine-windows.dll.node`) is
   present under
   `dist-desktop/app/.next/standalone/node_modules/.prisma/client/`.
2. **`prisma db push` at runtime.** `electron/db.cjs` shells out to the bundled
   Prisma CLI (`node_modules/prisma/build/index.js`) with the app's Node runtime.
   Ensure `prisma` + `@prisma/engines` were copied into `dist-desktop/app`
   (handled by the assemble script) and that `asarUnpack: ["**/*.node"]` keeps
   the native engine loadable.
3. **Run `npm run typecheck` and `npm run lint`** once dependencies are
   installed — these validate the SQLite type adaptations against the generated
   client.
4. **Code signing** is not configured; unsigned installers will trigger
   SmartScreen. Add a signing certificate to `electron-builder.yml` for release.
