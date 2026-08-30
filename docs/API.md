# AgentVault — API Reference

> This file documents the memory taxonomy, the project **context package**, and
> the **REST endpoints**. The category enum and context shape come from
> [`src/lib/categories.ts`](../src/lib/categories.ts) and
> [`src/server/context.ts`](../src/server/context.ts); the endpoints are
> implemented under [`src/app/api`](../src/app/api) and consumed by the
> [`amc-mcp`](../packages/amc-mcp) server.

## REST endpoints

All routes run on the Node.js runtime and resolve the acting user two ways:

- **`Authorization: Bearer amc_…`** — an API key (how `amc-mcp` / CLI agents call in).
- **Supabase session cookie** — how the web dashboard calls its own API.

Resources are addressed by **project slug** externally; the service layer is
id-based, so each route translates `:slug` → project id (scoped to the caller).
Success bodies are single-key envelopes; errors are `{ "error": string }` with a
matching status (`400` validation, `401` unauthenticated, `403` forbidden,
`404` not-found/not-owned, `429` rate limited, `503` database not configured).

A resource belonging to another user is **`404`, never `403`** — a 403 would
confirm it exists.

| Method & path | Auth | Body / query | Success |
| --- | --- | --- | --- |
| `GET /api/projects` | key or session | — | `{ projects }` |
| `POST /api/projects` | key or session | `{ name }` | `201 { project }` |
| `DELETE /api/projects/:slug` | key or session | — | `204` |
| `GET /api/projects/:slug/context` | key or session | `Accept: text/markdown` → raw markdown; else JSON | `ProjectContext` (see below) |
| `GET /api/projects/:slug/search` | key or session | `?query=&limit=` (limit 1–50, default 10) | `{ results }` (each with `score`) |
| `GET /api/projects/:slug/memories` | key or session | `?category=` (optional) | `{ memories }` |
| `POST /api/projects/:slug/memories` | key or session | `{ title, content, category?, importance? }` | `201 { memory }` |
| `GET /api/memories/:id` | key or session | — | `{ memory }` |
| `PATCH /api/memories/:id` | key or session | any of `{ title, content, category, importance }` | `{ memory }` |
| `DELETE /api/memories/:id` | key or session | — | `204` |
| `GET /api/keys` | **session only** | — | `{ keys }` (masked; no secret) |
| `POST /api/keys` | **session only** | `{ label? }` | `201 { key }` (raw secret, **shown once**) |
| `DELETE /api/keys/:id` | **session only** | — | `204` |

Key management is session-only so a leaked API key can't mint sibling keys. The
raw key secret (`amc_…`) is returned exactly once, at creation, and stored only
as a SHA-256 hash thereafter.

### Rate limits

Every route is rate limited, keyed on the authenticated user (sign-in is keyed
on client IP, since there is no user yet). Over budget, a route returns `429`
with `Retry-After` in whole seconds:

| Scope | Budget |
| --- | --- |
| `POST /api/auth/local` | 10 / 10 min per IP |
| `GET /api/projects/:slug/search`, `POST /api/projects/:slug/memories`, `PATCH /api/memories/:id` | 30 / min |
| `POST /api/keys` | 10 / hour |
| Everything else | 240 / min |

Every response carries `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset` on the 429 so a client can pace itself rather than retry
blindly. See [Rate limiting](../README.md#rate-limiting) for what the in-process
counter does and does not protect against.

## Category enum

Every memory has exactly one `category` drawn from a fixed, closed set. The set
is defined once in `src/lib/categories.ts` (`MEMORY_CATEGORIES`) and validated
with the Zod enum `memoryCategorySchema`. Requests with any other value are
rejected. The default is `General`.

| Value                   | Label                  | Priority | Meaning |
| ----------------------- | ---------------------- | :------: | ------- |
| `Architecture`          | Architecture           |    ★     | System shape, boundaries, and how major pieces fit together. |
| `TechnicalDecision`     | Technical Decision     |    ★     | A choice made between alternatives, with its rationale. |
| `BugReport`             | Bug Report             |          | A reproducible defect and the conditions that trigger it. |
| `BugFix`                | Bug Fix                |          | How a defect was resolved and why the fix works. |
| `Documentation`         | Documentation          |          | Explanatory notes, guides, and how-tos. |
| `ApiReference`          | API Reference          |          | Endpoint contracts, payload shapes, and integration details. |
| `Configuration`         | Configuration          |          | Environment, build, and deployment settings. |
| `Task`                  | Task                   |          | Actionable work items and their current state. |
| `MeetingNotes`          | Meeting Notes          |          | Discussion outcomes and follow-ups. |
| `Research`              | Research               |          | Investigations, findings, and reference material. |
| `CodingStandard`        | Coding Standard        |    ★     | Conventions the codebase must follow. |
| `DevelopmentPreference` | Development Preference |    ★     | How this team likes to work (tools, workflow, style). |
| `SecurityNote`          | Security Note          |          | Threats, hardening steps, and sensitive-handling rules. |
| `General`               | General                |          | Anything that doesn't fit a more specific category. |

★ = **priority category**. Priority categories (`PRIORITY_CATEGORIES`) always
lead the context package — see below.

### Importance

`importance` is an integer on a 1–5 scale (`importanceSchema`), default `3`:

| Value | Label    |
| :---: | -------- |
|   1   | Low      |
|   2   | Minor    |
|   3   | Moderate |
|   4   | High     |
|   5   | Critical |

### Using the enum (do not hardcode)

Forms, filters, and API validation must import from the single source of truth
rather than re-declaring the list:

```ts
import {
  MEMORY_CATEGORIES,       // readonly string[] in display order
  memoryCategorySchema,    // z.enum(...) for validation
  importanceSchema,        // z.number().int().min(1).max(5)
  CATEGORY_META,           // per-category { label, description, badgeClass }
} from "@/lib/categories";
```

## Memory input

Create/update bodies are validated with `memoryInputSchema`
([`src/lib/validation.ts`](../src/lib/validation.ts)):

```jsonc
{
  "title": "string, 1–200 chars",
  "content": "string, 1–20000 chars",
  "category": "Architecture",   // one of MEMORY_CATEGORIES; defaults to "General"
  "importance": 4                // integer 1–5; defaults to 3
}
```

`memoryUpdateSchema` is the same shape with every field optional (PATCH).

## Project context package

`GET /api/projects/:id/context` returns a **context package**: a compact,
grouped, size-capped view of a project's memories that an agent can inject
directly into its working context. It is produced by `getProjectContext`
(async, DB-backed) which wraps the pure `buildProjectContext`.

### Selection & ordering

1. **Priority categories first** — `Architecture`, `TechnicalDecision`,
   `CodingStandard`, `DevelopmentPreference` — ranked by importance, then
   recency. Always eligible regardless of importance.
2. **Then other categories** — the most-recent, high-importance items
   (importance ≥ `minOtherImportance`, default 3), ranked importance → recency.
3. **Size cap** — items are packed greedily under `tokenBudget` (default
   **2000**, estimated at ~4 chars/token). A single overlong memory's `content`
   is truncated at `perItemTokenCap` (default 480) and flagged `truncated`.
   Items that don't fit are omitted and counted, so the package always stays
   injectable.

Only memories with `status === "approved"` are considered.

### Response shape (`ProjectContext`)

```jsonc
{
  "projectId": "amc-web",
  "generatedAt": "2026-07-12T12:00:00.000Z",
  "tokenBudget": 2000,
  "tokenEstimate": 1094,          // estimated tokens of `markdown`
  "counts": {
    "total": 12,                  // approved memories considered
    "included": 10,               // memories in the package
    "omitted": 2                  // dropped (budget / eligibility)
  },
  "groups": [                     // priority categories first, then canonical order
    {
      "category": "Architecture",
      "label": "Architecture",
      "priority": true,
      "items": [
        {
          "id": "m1",
          "title": "Two-connection Postgres setup (pooled + direct)",
          "content": "App runtime uses the pooled DATABASE_URL …",
          "importance": 5,
          "updatedAt": "2026-07-10T09:00:00.000Z",
          "truncated": false
        }
      ]
    }
    // … more groups
  ],
  "markdown": "# Project Context: amc-web\n_10 of 12 memories · …_\n\n## Architecture ⭐\n\n### …"
}
```

### The `markdown` field

`markdown` is a ready-to-inject rendering of `groups`. Agents that just want
context can ignore the structured fields and drop `markdown` straight into a
system/context prompt. Priority category headings are marked with `⭐`; each
item shows its importance label and a `truncated` note when shortened:

```markdown
# Project Context: amc-web
_10 of 12 memories · budget 2000 tokens · generated 2026-07-12T12:00:00.000Z_

## Architecture ⭐

### Two-connection Postgres setup (pooled + direct)
_importance 5 Critical_

App runtime uses the pooled DATABASE_URL (Supabase pgBouncer). Migrations use
the direct DIRECT_URL. …

## Technical Decision ⭐

### Pin Next.js to 15.5.20 (not 16)
_importance 5 Critical_

…
```

### Options (`buildProjectContext` / `getProjectContext`)

| Option              | Default | Meaning |
| ------------------- | :-----: | ------- |
| `tokenBudget`       | `2000`  | Total token cap for the package. |
| `perItemTokenCap`   | `480`   | Max tokens of a single memory before truncation. |
| `minOtherImportance`| `3`     | Minimum importance for a **non-priority** memory to be eligible. |
| `generatedAt`       | `now`   | Injectable clock for deterministic output. |

You can reproduce a full sample package locally:

```bash
pnpm exec tsc -p tsconfig.demo.json && node scripts/run-demo.cjs
```
