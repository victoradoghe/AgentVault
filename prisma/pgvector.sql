-- Out-of-band SQL for AgentVault: pgvector, plus index catch-up for databases
-- created before an index was added to the Prisma schema.
--
-- Prisma can't model a `vector` column, so the embedding lives outside the
-- Prisma schema and is managed here. Run this AFTER `prisma db push` (which
-- creates the `memories` table). Every statement is idempotent, so it's safe
-- to re-run.
--
--   pnpm db:setup   -- runs `prisma db push` then applies this file

-- 1. The pgvector extension (provides the `vector` type and `<=>` operators).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. The 384-dim embedding column on memories (matches all-MiniLM-L6-v2).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(384);

-- 3. An HNSW index for fast cosine-distance nearest-neighbour search.
CREATE INDEX IF NOT EXISTS memories_embedding_cosine_idx
  ON memories USING hnsw (embedding vector_cosine_ops);

-- 4. The lookup index behind API-key authentication.
--
-- Declared in the Prisma schema (`keyHash String @unique`), so `prisma db push`
-- creates it on a fresh database. It is repeated here — under the exact name
-- Prisma uses, so push treats it as already applied — because databases created
-- before it existed authenticate every single API request with a sequential scan
-- of api_keys, and nothing else would ever fix them.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_key
  ON api_keys (key_hash);
