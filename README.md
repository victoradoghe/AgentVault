# AgentVault

Persistent, semantically-searchable memory for AI coding agents.

Coding agents start every session cold. AgentVault gives them a project-scoped memory
they can read at the start of a task and write to as decisions get made — so the
architectural choice you explained last week doesn't have to be explained again.

Connect any MCP-capable agent (Claude Code, Codex CLI, OpenCode) with an API key
and it gains six memory tools. A web dashboard lets you read, edit, and curate
what your agents remember.

```
┌─────────────────┐   MCP (stdio)   ┌──────────────┐   HTTPS + API key   ┌────────────────┐
│  Coding agent   │ ──────────────► │   amc-mcp    │ ──────────────────► │ AgentVault API │
│ (Claude Code…)  │                 │ (thin client)│                     │   (Next.js)    │
└─────────────────┘                 └──────────────┘                     └───────┬────────┘
                                                                                 │
                                            ┌────────────────────────────────────┴───────┐
                                            │  Service layer (src/server/*)              │
                                            │  projects · memories · search · context    │
                                            └────────────────────┬───────────────────────┘
                                                                 │
                                            ┌────────────────────┴───────────────────────┐
                                            │  Postgres + pgvector                        │
                                            │  384-d embeddings (all-MiniLM-L6-v2, local) │
                                            └─────────────────────────────────────────────┘
```

Embeddings are computed **in-process** with `@xenova/transformers` — no OpenAI
key, no per-token embedding cost, no memory content leaving your infrastructure.

## What it does

- **Semantic search** — pgvector cosine similarity over every memory, so
  "how do we handle currency?" finds "Money is always integer minor units" with
  no shared keywords.
- **Context packages** — `get_project_context` returns a compact, token-budgeted
  markdown bundle of a project's defining decisions, ranked so architecture and
  conventions always lead. Drop it straight into a system prompt.
- **A curated taxonomy** — 14 categories and a 1–5 importance scale, defined once
  in [`src/lib/categories.ts`](src/lib/categories.ts) and enforced everywhere.
- **Per-user isolation** — every query is scoped to the acting user; a
  cross-user id returns "not found" rather than leaking existence.
- **Works offline** — agents keep reading cached memory and keep saving new ones
  (queued on disk, synced on reconnect), and the dashboard stays readable with no
  connection. See below.

## Quick start

Requires **Node 18.18+**, **pnpm**, and a **Postgres database with pgvector**
(Supabase works out of the box).

```bash
pnpm install
cp .env.example .env      # then fill in DATABASE_URL and DIRECT_URL
pnpm db:setup             # push the Prisma schema + apply pgvector.sql
pnpm verify               # prove the whole stack works, end to end
pnpm dev                  # http://localhost:3000
```

`pnpm verify` is the one command worth running first. It walks the stack in
dependency order — env vars, database connection, schema, pgvector extension,
embedding model, then a full create → search → context round trip against real
data — and stops at the first failure with the specific fix. It catches the
common setup traps, including a half-filled `.env` whose placeholder still
parses as a valid URL.

### Authentication

AgentVault resolves to one of three auth modes, chosen automatically:

| Mode | When | Behaviour |
| --- | --- | --- |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_*` set | Real Supabase Auth (email + password). The only mode fit for production. |
| **Local** | Supabase vars unset, **and not a production build** | "Log in" with any email, no password. Session is an HMAC-signed cookie. Development only. |
| **Unconfigured** | Supabase vars unset **in production** | Nobody can sign in. The login page says what's missing. |

Filling in the Supabase variables switches the entire app over — no code change.
See [`src/lib/auth-mode.ts`](src/lib/auth-mode.ts).

**Local mode is an authentication bypass by design** — no password, so anyone
who can reach the app can claim any email and read that user's memories. That is
fine on a laptop and unacceptable on a public host, so a production build will
not fall back to it: a deploy that forgets a Supabase variable fails closed
(nobody signs in) instead of silently opening up. To run it in production anyway
— only sensible behind a private network — set both
`NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH=true` and `AMC_LOCAL_AUTH_SECRET`. The
committed dev signing secret is refused in production, because with it any
visitor could forge a session cookie for any account.

`pnpm verify` checks all of this and fails with the specific fix.

## Connecting an agent

1. Build the MCP server once: `pnpm --filter amc-mcp build`.
2. Start the app and open **Settings → API Keys**. Create a key (`amc_…`) — it is shown
   **once**, and only its SHA-256 hash is stored.
3. Open **Dashboard → Connect your agent**, paste the key, and copy the generated
   command for Claude Code, Codex CLI, or OpenCode.

That page fills in your key and the correct base URL, so the command runs as-is.
The manual equivalent looks like this:

```bash
claude mcp add agentvault \
  -e AMC_API_KEY=amc_your_key_here \
  -e AMC_BASE_URL=http://localhost:3000 \
  -- node /absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js
```

> `npx -y amc-mcp` does **not** work — the package isn't published to npm, so agents
> launch the built entrypoint by absolute path (which is what the dashboard generates).
> Once it is published, set `MCP_PACKAGE_NAME` and that page switches to `npx` commands.
> `AMC_BASE_URL` defaults to `http://127.0.0.1:3000`; set it to wherever the app is
> actually served.

Codex CLI and OpenCode configs are in [`packages/amc-mcp/README.md`](packages/amc-mcp/README.md).

The agent then has six tools: `list_projects`, `get_project_context`,
`search_memory`, `save_memory`, `list_memories`, and `delete_memory`.

## Offline access

The memories your agents saved are exactly what you want when the connection
isn't there, so AgentVault degrades rather than breaks. There are three
independent pieces, because "offline" hits three different places:

| If the connection drops… | What still works | Where |
| --- | --- | --- |
| …for **your agent** (MCP) | Reads serve the last cached copy; saves queue on disk and sync automatically | [`packages/amc-mcp/src/offline.ts`](packages/amc-mcp/src/offline.ts) |
| …for **the dashboard** | Projects and memories stay readable; editing is disabled | [`src/lib/offline/cache.ts`](src/lib/offline/cache.ts) + [`public/sw.js`](public/sw.js) |
| …for **the server itself** | Embedding still runs, from the locally cached model | [`src/server/embeddings.ts`](src/server/embeddings.ts) |

### Agents keep working

This is the one that matters most: an agent that loses a saved decision to a
flaky connection has failed at the only job this product has. So `save_memory`
**succeeds while offline** — the memory goes to a durable on-disk queue and is
replayed, in order, on the next call that reaches the server. Reads fall back to
the last cached copy, labelled with its age, and `search_memory` degrades to a
keyword scan over every memory the cache has seen — from listings, from earlier
searches, and from saves made offline. Full details and the env vars are in
[`packages/amc-mcp/README.md`](packages/amc-mcp/README.md#working-offline).

Only a genuinely unreachable server triggers any of this: a 401 or a 500 means
the server answered, and is reported as the error it is.

### The embedding model must be local first

Saving and searching embed text with a model that is downloaded once (~90 MB)
and then runs entirely in-process. Prime it while you have a connection:

```bash
pnpm model:fetch
```

It is cached in `.model-cache/` (override with `AMC_MODEL_CACHE_DIR`) —
deliberately **outside `node_modules`**, so that `pnpm install` doesn't silently
delete your offline capability. On a host with a read-only working directory
(serverless), it falls back to the system temp directory instead of failing. Without this step, the first memory saved on a
disconnected machine fails with a download error.

### The dashboard stays readable

Two layers make that work, and both are needed:

| Layer | What it holds | Where |
| --- | --- | --- |
| Data cache | Every successful project/memory list, per user | `localStorage` — [`src/lib/offline/cache.ts`](src/lib/offline/cache.ts) |
| App shell | The page HTML and Next's build assets | Cache Storage — [`public/sw.js`](public/sw.js) |

The data cache alone isn't enough: it can only help once the page is running,
and the page can't run if the browser couldn't fetch its HTML. The service
worker serves the shell, the page boots, and the cached rows paint on the first
frame.

**What you get offline**: the project list, each project's memories, categories,
importance, and content — everything except the actions that need a server.
Creating, editing, and deleting are disabled, and semantic search is too (it
runs the embedding model server-side). A banner names the state and each view
says when its copy was captured.

Three details worth knowing:

- **"Offline" means the API is unreachable**, not `navigator.onLine` — that flag
  is `true` on a captive-portal wifi and says nothing about our server. The real
  signal is the last request: no response at all means offline, while an HTTP
  error (even a 500) proves we got through.
- **Cached data is scoped per user and cleared on sign-out**, along with the
  service worker's pages. A shared machine must not keep the previous account's
  memories readable.
- **`/api/*` is never cached by the service worker.** Those responses are
  per-user and authenticated; replaying them from a shared cache is how one
  account ends up seeing another's data. They live only in the namespaced
  `localStorage` cache.

The service worker registers in production builds only — it serves
`/_next/static/*` cache-first, which is correct for content-hashed output and
would hand a dev server stale chunks. `pnpm dev` actively unregisters it.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Pooled Postgres connection (app runtime). Keep `?pgbouncer=true` on Supabase. |
| `DIRECT_URL` | ✅ | Direct Postgres connection (migrations only). |
| `NEXT_PUBLIC_SUPABASE_URL` | prod | Enables Supabase auth. Blank in dev → local auth mode; blank in production → nobody can sign in. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | prod | Browser-safe public key. Supabase's current name for it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | The older name for the same key. Either variable works — see [`src/lib/supabase/keys.ts`](src/lib/supabase/keys.ts). |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only, optional. Nothing reads it today. Never expose to the browser. |
| `AMC_LOCAL_AUTH_SECRET` | — | Signs local-mode session cookies. Dev fallback if unset; **required** if local mode is enabled in production. |
| `NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH` | — | Set to `true` to permit passwordless local auth in a production build. Off by default — read the auth section first. |
| `AMC_DB_TRANSACTION_MAX_WAIT_MS` | — | Transaction acquire budget (default 20s). Tighten for a local database. |
| `AMC_DB_TRANSACTION_TIMEOUT_MS` | — | Transaction run budget (default 60s). |
| `HF_ENDPOINT` | — | Mirror host for the embedding model on restricted networks. |
| `AMC_MODEL_CACHE_DIR` | — | Where the embedding model is cached (default `.model-cache/`). Kept outside `node_modules` so a reinstall can't break offline embedding. |

Nothing in [`src/lib/env.ts`](src/lib/env.ts) throws at import: the app boots
without a database so local auth and the dashboard shell still work, and
DB-backed routes return a clear `503 Database not configured`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server. **Webpack, not Turbopack** — see below. |
| `pnpm build` | Production build. **Webpack, not Turbopack** — see below. |
| `pnpm test` | Unit tests (Vitest). No database or network needed. |
| `pnpm test:watch` | Tests in watch mode. |
| `pnpm verify` | Full end-to-end stack verification against a live database. |
| `pnpm db:setup` | `prisma db push` + apply `prisma/pgvector.sql`. |
| `pnpm db:push` / `db:migrate` / `db:studio` | Standard Prisma commands. |
| `pnpm model:fetch` | Download the embedding model so embedding works offline. Run once, while online. |
| `pnpm smoke` | Dev-only service-layer walkthrough with printed output. |

## Project layout

```
src/
  app/
    api/                  REST API (Node runtime, force-dynamic)
    dashboard/            Projects, memories, search, API keys
    login/  register/     Auth pages
  server/                 Service layer — ALL business logic
    projects.ts  memories.ts  search.ts  context.ts
    embeddings.ts  apiKeys.ts  auth.ts  schemas.ts
  lib/
    categories.ts         The memory taxonomy (single source of truth)
    validation.ts  env.ts  auth-mode.ts  prisma.ts
    offline/              Local cache + read-through hook (offline reads)
packages/amc-mcp/         The MCP server (thin REST client, publishable)
prisma/                   Schema + pgvector.sql
public/sw.js              Service worker — serves the app shell offline
tests/                    Vitest unit tests
docs/API.md               Full REST + taxonomy + context reference
```

The layering rule: **route handlers and the MCP server never touch Prisma or
embeddings directly.** All business logic lives in `src/server/*`, so the REST
API and MCP server get identical behaviour and identical ownership checks. See
[`src/server/README.md`](src/server/README.md).

## Testing

```bash
pnpm test      # 124 unit tests, no I/O
pnpm verify    # end-to-end, needs a live database
```

The unit suite covers the pure logic — context packing and token budgeting, the
category taxonomy's invariants, input validation, slug generation, session-token
signing and tamper rejection, auth-mode resolution and its production
fail-closed rules, the offline cache's per-user isolation, and the MCP client's
envelope unwrapping and error mapping. Anything requiring real Postgres or the
embedding model is covered by `pnpm verify` instead.

## Deployment

Deploys to Vercel as a standard Next.js app. Three things to know:

- **Embedding needs a writable cache and egress.** The ~90 MB model is fetched
  from huggingface.co on the first save and cached on disk; on a serverless host
  that cache lands in the temp directory and every cold container pays for it
  again. Set `AMC_MODEL_CACHE_DIR` to persistent storage where you have it.
- **Set `DATABASE_URL`, `DIRECT_URL`, and the Supabase variables** in the host's
  environment, then run `pnpm db:setup` once against the production database.
  The Supabase variables are not optional in production: without them the app
  has no way to authenticate anyone (see [Authentication](#authentication)).
- **Both `dev` and `build` use webpack, not Turbopack.** `next build --turbopack`
  fails collecting page data for the dynamic API routes
  (`PageNotFoundError: Cannot find module for page: /api/...`). `next dev
  --turbopack` is broken too, but only on the routes that embed text: the
  request kills its worker (`Jest worker encountered 2 child process
  exceptions`), so `save_memory` and `get_project_context` return a 500 HTML
  error page. The write often lands before the worker dies, which makes it look
  like a client timeout rather than a crash. Don't "restore" `--turbopack` to
  either script.

The native embedding dependencies (`@xenova/transformers`, `onnxruntime-node`,
`sharp`) are listed in `serverExternalPackages` in
[`next.config.ts`](next.config.ts) so their `.node` binaries aren't bundled into
the route handlers. The model downloads on first use, so the first embedding
call after a cold deploy is slow (~15–20s); everything after is fast.

## Documentation

- [`docs/API.md`](docs/API.md) — REST endpoints, the category taxonomy, and the
  context package format.
- [`packages/amc-mcp/README.md`](packages/amc-mcp/README.md) — MCP server setup
  for Claude Code, Codex CLI, and OpenCode.
- [`src/server/README.md`](src/server/README.md) — service-layer conventions.

## License

MIT
