# Social Autopilot

An internal, autonomous social-media content tool. AI drafts posts in your brand
voice; **you review and approve them each morning**; approved posts are scheduled
and published across LinkedIn, Facebook, X, and Instagram.

> Phase 0 scaffold. The full generate → review → schedule → publish loop is
> implemented. Live publishing is gated on each platform's app approval (see
> [Platform requirements](#platform-api-requirements)); until then you can fully
> draft, review, approve, and schedule — publishing simply waits for a connection.

## How it works

```
        ┌───────────┐     ┌──────────────┐     ┌───────────┐     ┌───────────┐
topic ─▶ │ AI drafts │ ──▶ │ Morning      │ ──▶ │ Scheduler │ ──▶ │ Publishers│
        │ (per      │     │ review queue │     │ (BullMQ)  │     │ LI/FB/X/IG│
        │  platform)│     │ approve/edit │     │           │     │           │
        └───────────┘     └──────────────┘     └───────────┘     └───────────┘
         provider-agnostic   nothing publishes    drips across      refuses to post
         LLM (mock/OpenAI/    without your         your daily        without a real
         Anthropic)          explicit approval     posting slots     connection
```

Nothing ever moves past `pending_review` without an explicit human action — this
is enforced by a state machine in `src/core/review/queue.ts`, not by convention.

## Tech stack

- **Next.js 15** (App Router) + React 19 + TypeScript + Tailwind
- **PostgreSQL** via **Prisma**
- **Redis + BullMQ** for scheduling/queueing
- **Provider-agnostic LLM** layer (`mock` | `openai` | `anthropic`), no SDK lock-in

## Project structure

```
src/
  core/                 # Dependency-free domain logic (no npm deps).
    types.ts            #   shared domain types
    llm/                #   provider interface + mock/openai/anthropic adapters + factory
    brand/voice.ts      #   brand-voice -> system prompt + lexical asset retrieval (RAG stand-in)
    content/            #   platform rules, prompt assembly, generator
    review/queue.ts     #   review state machine (the approval guarantee)
    schedule/planner.ts #   slot-based scheduling + next-review window
    devtools/verify.ts  #   runtime smoke test (run via `npm run verify:core`)
  lib/                  # Integration singletons: db (Prisma), llm, queue (BullMQ)
  server/               # Server-only: publishers, oauth config, token crypto, services
  app/                  # Next.js routes, server actions, UI
  components/           # Client components (review cards, forms)
  worker/               # BullMQ worker: publishes scheduled posts
prisma/                 # schema + seed
```

The **core is intentionally dependency-free** so the most important business
logic can be type-checked and executed without installing anything — see below.

## Quickstart

```bash
npm install
cp .env.example .env        # then fill in values (defaults work for local dev with mock LLM)

# bring up Postgres + Redis (any method; docker example):
# docker run -d --name pg  -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
# docker run -d --name redis -p 6379:6379 redis:7

npm run db:migrate          # create tables
npm run db:seed             # demo brand + a first batch of drafts
npm run dev                 # http://localhost:3000  (the morning review queue)
npm run worker              # in a second terminal: processes scheduled publishes
```

Open the app, generate drafts for a topic, then approve / edit / schedule them.

### Verify the core without any setup

The core logic runs with **zero installed packages** (handy in restricted/CI
environments). It compiles `src/core` with TypeScript and executes a smoke test:

```bash
npm run verify:core
```

This exercises generate → review → schedule end-to-end with the deterministic
mock LLM and asserts the key invariants (per-platform limits, approval gating,
illegal-transition guard, chronological scheduling).

## Configuration

See [`.env.example`](./.env.example). Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection for BullMQ |
| `LLM_PROVIDER` | `mock` (default, offline), `openai`, or `anthropic` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Credentials for the chosen provider |
| `REVIEW_TIMEZONE` | IANA tz for the morning window + posting slots (e.g. `Europe/Oslo`) |
| `POSTING_SLOT_HOURS` | Comma-separated local hours to drip posts, e.g. `9,13,17` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 key for encrypting OAuth tokens at rest |
| `*_CLIENT_ID` / `*_SECRET` | Per-platform OAuth app credentials |

Switching LLM providers is a one-line `.env` change — no code edits.

## Platform API requirements

The hardest part of this product is **platform access**, not the AI. Each
integration needs an approved app before it can publish; approvals take time, so
the app is designed to be useful before they land.

| Platform | What's needed | Notes |
| --- | --- | --- |
| **LinkedIn** | App with *Share on LinkedIn*; Company Page posting needs *Community Management API* | Member shares work with basic approval |
| **Facebook** | Meta app with `pages_manage_posts` (App Review) | Publishes to a Page with a Page token |
| **Instagram** | IG Business/Creator linked to a FB Page + `instagram_content_publish` (App Review) | **No text-only posts** — requires an image/video (Phase 2) |
| **X** | Developer app on a **paid** tier (Basic+) with `tweet.write` | Free tier generally cannot publish |

`publish()` never fakes success: with no connected account it returns a clear
`notConfigured` error instead of pretending to post.

## Roadmap

- **Phase 0 (this scaffold):** generation → review queue → scheduling; publisher
  + OAuth scaffolding; offline-verifiable core.
- **Phase 1 (done):** LinkedIn OAuth identity resolution (person URN via OpenID
  userinfo) + token refresh + member-share publishing.
- **Phase 2 (done):** Meta (Facebook + Instagram) — long-lived user tokens,
  Page-token identity resolution via `/me/accounts`, IG business-account
  discovery, and the Instagram media pipeline (attach image URLs in the queue).
- **Phase 3 (done):** analytics pull-back (engagement metrics per platform),
  per-channel autonomy dial (manual / review-required / auto), and multi-account
  (multi-Page) selection for Meta.
- **Phase 4:** X publishing once a paid tier is available; eval tooling
  (repetition/off-brand detection); team/agency permissions; pgvector-backed
  semantic RAG over brand assets.

## Notes

- **Autonomy dial:** each connected account has an autonomy level (set on the
  Connections page). `review_required` (default) routes drafts to the morning
  queue; `auto` approves + schedules them immediately without review; `manual`
  keeps them in the queue for you to handle. Autonomy is per active account.
- **Analytics pull-back:** after a post publishes, the worker schedules metric
  pulls at +1h and +24h (likes/comments/shares/impressions/reach, normalised
  per platform). A "Refresh" button on each published card pulls on demand.
  History is kept in `VariantMetricSnapshot` for trends/evaluation.
- **Multi-account / multi-Page:** connecting Meta stores every Page (and every
  IG-linked Page) you manage; pick the active one per platform on the
  Connections page. Scheduling links each variant to its platform's active
  account, and that's what the worker publishes through.
- **Meta token model:** the OAuth code exchange yields a short-lived user token,
  which is upgraded to a long-lived one; publishing then uses the **Page access
  token** discovered during identity resolution (Page tokens from long-lived
  user tokens don't expire). Set `META_PAGE_ID` to pre-select a Page.
- **Instagram** has no text-only posts — attach a public image URL to a variant
  in the review queue before approving (the card shows an "Image…" control and
  flags IG variants that still need media).
- OAuth tokens are encrypted at rest (AES-256-GCM) and auto-refreshed before
  publishing via `src/server/tokens.ts` when the platform supports it.
- `src/core/brand/voice.ts` uses lexical keyword matching as a stand-in for the
  pgvector semantic retrieval planned in Phase 4.
- The `mock` provider is deterministic (seeded), so generated content is
  reproducible in tests and demos.
