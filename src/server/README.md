# server/ — Core Memory Service (phase 4)

Server-only service layer for AgentVault. **All memory business logic
lives here.** The REST API (phase 5) and the MCP server (phase 6) call these
functions; neither ever touches Prisma or the embedding model directly.

## Modules

| File             | Responsibility                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| `schemas.ts`     | Zod input schemas for every service call (category/importance from `@/lib/categories`). |
| `errors.ts`      | Typed `ServiceError`s (`NotFoundError`, `ConflictError`) for callers to map to HTTP. |
| `embeddings.ts`  | `embed(text)` → 384-dim normalised vector via `Xenova/all-MiniLM-L6-v2` (lazy singleton). |
| `projects.ts`    | `createProject`, `listProjects`, `getProjectBySlug`, `deleteProject` (+ slug generation). |
| `memories.ts`    | Core CRUD: `createMemory`, `updateMemory`, `deleteMemory`, `listMemories`, `getMemory`. |
| `search.ts`      | `searchMemories` (pgvector cosine `<=>`) and `getProjectContext` (session bundle). |

## Rules baked in

- **Ownership** — every function takes the acting `userId` and scopes its query
  to it. Cross-user access finds nothing and raises `NotFoundError`, so a user
  can never read or mutate another user's data, and existence is never leaked.
- **Validation** — inputs are parsed with the Zod schemas in `schemas.ts` before
  any DB work.
- **Embeddings** — `createMemory`/`updateMemory` embed `${title}\n\n${content}`
  and write the vector to the pgvector `embedding vector(384)` column via raw SQL
  inside the same transaction as the insert, so a memory never lacks its vector.

## Database setup

The `embedding` column can't be modeled in Prisma, so it's created out-of-band:

```bash
pnpm db:setup   # prisma db push  +  apply prisma/pgvector.sql
```

## Dev smoke test

`scripts/smoke.ts` exercises the whole layer end-to-end against a live
Postgres+pgvector:

```bash
pnpm db:setup   # once, after configuring .env
pnpm smoke
```

The model (~90 MB) downloads from the Hugging Face Hub on first run and is then
cached. On networks that can't reach `huggingface.co`, set `HF_ENDPOINT` to a
reachable mirror.
