# Running Social Autopilot locally

This guide gets the app running on your own machine (Windows, macOS, or Linux).
It works out of the box with **no API keys** — it uses an offline "mock" AI so
you can click through the whole flow immediately.

There are two ways to run it. **Option A (Docker) is the easiest — pick that
unless you specifically want the Node setup.**

---

## Option A — Docker (recommended, one command)

### 1. Install Docker Desktop
- Windows / macOS: install **Docker Desktop** and start it (wait until it says
  "Docker is running"). On Windows it will use the WSL2 backend.
- Linux: install Docker Engine + the Compose plugin.

### 2. Get the code
```bash
git clone https://github.com/darryllindner-boop/socials.git
cd socials
git checkout phase-0-scaffold
```

### 3. Start everything
```bash
docker compose up --build
```
This starts Postgres, Redis, creates the database, seeds demo content, and runs
both the web app and the background worker. The first build takes a few minutes;
later starts are fast.

### 4. Open the app
- **http://localhost:3000** — the morning review queue (4 demo drafts are
  already there)
- **http://localhost:3000/analytics** — the analytics dashboard
- **http://localhost:3000/connections** — connect social accounts

### Stop / reset
- Stop: press `Ctrl+C` in the terminal.
- Stop + wipe the database: `docker compose down -v`
- After pulling new code: `docker compose up --build` again.

That's it. Everything below is only for the alternative Node setup or for
enabling real AI / real social posting.

---

## Option B — Node (no Docker for the app)

You still need Postgres and Redis running. The quickest way to get those is
Docker (two small containers); otherwise install them natively.

### 1. Prerequisites
- **Node.js 20 or newer** (`node --version`)
- **PostgreSQL** and **Redis**. Easiest:
  ```bash
  docker run -d --name sa-pg    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=socials -p 5432:5432 postgres:16
  docker run -d --name sa-redis -p 6379:6379 redis:7
  ```

### 2. Get the code + install
```bash
git clone https://github.com/darryllindner-boop/socials.git
cd socials
git checkout phase-0-scaffold
npm install
```

### 3. One-time setup
```bash
npm run setup
```
This creates your `.env` (from `.env.example`) and generates a secure
`TOKEN_ENCRYPTION_KEY` for you — no OpenSSL needed.

Open `.env` and make sure `DATABASE_URL` / `REDIS_URL` match your Postgres/Redis.
The defaults match the Docker commands above:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/socials?schema=public"
REDIS_URL="redis://localhost:6379"
```

### 4. Create the schema + demo data (Postgres must be running)
```bash
npm run setup:db
```

### 5. Run the app + worker
```bash
npm run dev:all
```
(Or, in two separate terminals: `npm run dev` and `npm run worker`.)

Open **http://localhost:3000**.

---

## What you can do once it's running

1. **Generate drafts** — use the form on the home page (topic + platforms).
2. **Review** — each draft shows an AI **quality score** and any issues; you can
   **Approve / Edit / Reject / Schedule**, or **Re-check** the eval.
3. **Schedule** — pick a time; the worker publishes at that time. With no social
   account connected, it will *safely refuse* to post (that's expected).
4. **Analytics** (`/analytics`) — engagement once posts are published.
5. **Connections** (`/connections`) — connect accounts and set per-channel
   autonomy (manual / review-required / auto).

### See repetition/“off-brand” detection in action
Generate a topic, **Approve** those drafts, then generate the **same topic
again** — the new drafts get flagged as repetition (and blocked). Or **Edit** a
draft to include `Try our [PRODUCT NAME]` and **Re-check** — it blocks the
template placeholder.

---

## Optional: use a real AI provider
In `.env` (Node) or `docker-compose.yml` (Docker), set:
```
LLM_PROVIDER="openai"          # or "anthropic"
OPENAI_API_KEY="sk-..."        # or ANTHROPIC_API_KEY
```
Restart the app/worker.

## Optional: connect real social accounts
Set the platform app credentials (e.g. `LINKEDIN_CLIENT_ID/SECRET`,
`META_APP_ID/SECRET`) and **change `TOKEN_ENCRYPTION_KEY`** to your own value.
Note that live posting requires each platform's app approval — see the
"Platform API requirements" table in the main `README.md`.

---

## Inspect the database
```bash
npx prisma studio        # opens http://localhost:5555
```

## Troubleshooting
- **"Database not reachable"** — Postgres isn't running or `DATABASE_URL` is
  wrong. Check the container (`docker ps`) and the value in `.env`.
- **Port already in use (3000 / 5432 / 6379)** — stop whatever is using it, or
  change the port mapping in `docker-compose.yml`.
- **Docker: "Cannot connect to the Docker daemon"** — Docker Desktop isn't
  running; start it and retry.
- **Prisma client errors after pulling new code** — run `npm run db:generate`
  (Node) or rebuild with `docker compose up --build` (Docker).
- **Worker doesn't publish a scheduled post** — keep the worker running and pick
  a time a minute or two in the future; without a connected account it will mark
  the post failed with "account not connected" (expected).
- **Windows** — run the commands in PowerShell or Git Bash. The setup script
  generates the encryption key for you, so OpenSSL is not required.
