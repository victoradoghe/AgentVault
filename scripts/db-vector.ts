/**
 * Runnable entry for the pgvector setup: `tsx scripts/db-vector.ts`.
 * Invoked by the `db:vector` and `db:setup` package scripts.
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";

import { applyPgVector } from "./apply-pgvector";

async function main() {
  await applyPgVector(prisma);
  console.log("✔ pgvector setup applied (extension + embedding column + index).");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("✖ pgvector setup failed:\n", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
