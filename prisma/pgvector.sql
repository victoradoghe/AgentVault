-- pgvector setup for Agent Memory Cloud.
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
