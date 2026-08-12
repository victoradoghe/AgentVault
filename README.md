# Agent Memory Cloud

Persistent, semantically-searchable memory for AI coding agents.

Coding agents start every session cold. AMC gives them a project-scoped memory
they can read at the start of a task and write to as decisions get made — so the
architectural choice you explained last week doesn't have to be explained again.

Connect any MCP-capable agent (Claude Code, Codex CLI, OpenCode) with an API key
and it gains six memory tools. A web dashboard lets you read, edit, and curate
what your agents remember.

```
┌─────────────────┐   MCP (stdio)   ┌──────────────┐   HTTPS + API key   ┌────────────────┐
│  Coding agent   │ ──────────────► │   amc-mcp    │ ──────────────────► │   AMC REST API │
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

AMC runs in one of two auth modes, chosen automatically:

| Mode | When | Behaviour |
| --- | --- | --- |
| **Local** | Supabase env vars unset | "Log in" with any email, no password. Session is an HMAC-signed cookie. Development only. |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_*` set | Real Supabase Auth (email + password). |

Filling in the Supabase variables switches the entire app over — no code change.
See [`src/lib/auth-mode.ts`](src/lib/auth-mode.ts).

## Connecting an agent

1. Start the app and open **Settings → API Keys**.
2. Create a key (`amc_…`). It is shown **once** — only its SHA-256 hash is stored.
3. Register the MCP server with your agent:

```bash
claude mcp add amc -e AMC_API_KEY=amc_your_key_here -- npx -y amc-mcp
```

Point at a local dev server by also passing `-e AMC_BASE_URL=http://localhost:3000`.
Codex CLI and OpenCode configs are in [`packages/amc-mcp/README.md`](packages/amc-mcp/README.md).

The agent then has six tools: `list_projects`, `get_project_context`,
`search_memory`, `save_memory`, `list_memories`, and `delete_memory`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Pooled Postgres connection (app runtime). Keep `?pgbouncer=true` on Supabase. |
| `DIRECT_URL` | ✅ | Direct Postgres connection (migrations only). |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Enables Supabase auth. Blank → local auth mode. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | Public anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only. Never expose to the browser. |
| `AMC_LOCAL_AUTH_SECRET` | — | Signs local-mode session cookies. Dev fallback if unset. |
| `HF_ENDPOINT` | — | Mirror host for the embedding model on restricted networks. |

Nothing in [`src/lib/env.ts`](src/lib/env.ts) throws at import: the app boots
without a database so local auth and the dashboard shell still work, and
DB-backed routes return a clear `503 Database not configured`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server (Turbopack). |
| `pnpm build` | Production build. **Webpack, not Turbopack** — see below. |
| `pnpm test` | Unit tests (Vitest). No database or network needed. |
| `pnpm test:watch` | Tests in watch mode. |
| `pnpm verify` | Full end-to-end stack verification against a live database. |
| `pnpm db:setup` | `prisma db push` + apply `prisma/pgvector.sql`. |
| `pnpm db:push` / `db:migrate` / `db:studio` | Standard Prisma commands. |
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
packages/amc-mcp/         The MCP server (thin REST client, publishable)
prisma/                   Schema + pgvector.sql
tests/                    Vitest unit tests
docs/API.md               Full REST + taxonomy + context reference
```

The layering rule: **route handlers and the MCP server never touch Prisma or
embeddings directly.** All business logic lives in `src/server/*`, so the REST
API and MCP server get identical behaviour and identical ownership checks. See
[`src/server/README.md`](src/server/README.md).

## Testing

```bash
pnpm test      # 82 unit tests, no I/O
pnpm verify    # end-to-end, needs a live database
```

The unit suite covers the pure logic — context packing and token budgeting, the
category taxonomy's invariants, input validation, slug generation, session-token
signing and tamper rejection, and the MCP client's envelope unwrapping and error
mapping. Anything requiring real Postgres or the embedding model is covered by
`pnpm verify` instead.

## Deployment

Deploys to Vercel as a standard Next.js app. Two things to know:

- **Set `DATABASE_URL`, `DIRECT_URL`, and the Supabase variables** in the host's
  environment, then run `pnpm db:setup` once against the production database.
- **The build uses webpack, not Turbopack.** `next build --turbopack` fails
  collecting page data for the dynamic API routes
  (`PageNotFoundError: Cannot find module for page: /api/...`). `dev` still uses
  Turbopack and is fine. Don't "restore" `--turbopack` to the build script.

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
