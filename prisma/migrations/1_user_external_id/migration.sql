-- Key a user on their auth provider's id, not their email address.
--
-- Email is mutable: changing it in Supabase used to produce a brand-new
-- AgentVault account, silently orphaning every project and memory the person
-- had. `external_id` records the provider's own stable id (Supabase's `sub`)
-- and becomes the preferred lookup key.
--
-- Additive and safe to apply to a populated database:
--   * The column is NULLABLE, so existing rows need no backfill.
--   * The UNIQUE index tolerates many NULLs in Postgres, so pre-existing rows
--     and local-dev-auth rows (which have no external identity) coexist.
--   * Existing users are matched by email exactly as before, and the column is
--     filled in on their next sign-in. See src/server/auth.ts.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "external_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");
