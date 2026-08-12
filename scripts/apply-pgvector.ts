/**
 * Applies `prisma/pgvector.sql` (extension + embedding column + index).
 *
 * Pure helper — reused by `scripts/db-vector.ts` (the `db:setup` / `db:vector`
 * commands) and by the smoke test. Run after `prisma db push` to finish setting
 * up the parts Prisma can't model. Idempotent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";

/** Read the SQL file, split into statements, and execute each one. */
export async function applyPgVector(prisma: PrismaClient): Promise<void> {
  const path = join(process.cwd(), "prisma", "pgvector.sql");
  const raw = readFileSync(path, "utf8");

  const statements = raw
    .split(";")
    .map((chunk) => chunk.replace(/--[^\n]*/g, "").trim()) // drop line comments
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
