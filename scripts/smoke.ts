/**
 * DEV-ONLY smoke test for the phase-4 core memory service.
 *
 * Exercises the real service layer end-to-end against a live Postgres+pgvector:
 *   1. creates a throwaway user + project,
 *   2. adds three memories (each gets a real embedding),
 *   3. runs a semantic search and prints results with similarity scores,
 *   4. prints the project context bundle,
 *   5. cleans up (deleting the user cascades to its project + memories).
 *
 * Prereqs: a `.env` with DATABASE_URL/DIRECT_URL and `pnpm db:push` already run.
 * This script ensures the pgvector column exists, so after `db:push` you can run
 * it directly:
 *
 *   pnpm smoke
 *
 * NOT part of the app. Safe to delete.
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { warmupEmbeddings } from "@/server/embeddings";
import { createMemory } from "@/server/memories";
import { createProject } from "@/server/projects";
import { getProjectContext, searchMemories } from "@/server/search";

import { applyPgVector } from "./apply-pgvector";

const SEED_MEMORIES = [
  {
    title: "Event-sourced ledger",
    content:
      "All balance changes are appended as immutable events; current balances are a projection rebuilt from the event log. Chosen for auditability and full replay.",
    category: "Architecture",
    importance: 5,
  },
  {
    title: "Use Temporal for payment workflows",
    content:
      "We adopted Temporal to orchestrate multi-step payment sagas (authorize, capture, settle) with durable retries instead of hand-rolled state machines.",
    category: "TechnicalDecision",
    importance: 4,
  },
  {
    title: "Money is always integer minor units",
    content:
      "Never use floats for money. Represent every amount as an integer number of minor units (cents) with an explicit ISO-4217 currency code.",
    category: "CodingStandard",
    importance: 5,
  },
] as const;

async function main() {
  console.log("▸ Ensuring pgvector schema (extension + embedding column)…");
  await applyPgVector(prisma);

  console.log("▸ Loading embedding model (first run downloads ~90 MB)…");
  await warmupEmbeddings();

  // Dev-only: mint a throwaway owner. Auth/users land in a later phase.
  const user = await prisma.user.create({
    data: { email: `smoke+${Date.now()}@amc.dev` },
  });
  console.log(`▸ Created throwaway user ${user.id}\n`);

  try {
    const project = await createProject({
      userId: user.id,
      name: "Orbital Payments Platform",
    });
    console.log(`▸ Project: "${project.name}"  (slug: ${project.slug})`);

    for (const seed of SEED_MEMORIES) {
      const memory = await createMemory({
        userId: user.id,
        projectId: project.id,
        ...seed,
      });
      console.log(`   • [${memory.category}] ${memory.title}`);
    }

    const query = "how should we represent currency and money amounts?";
    console.log(`\n▸ Semantic search — "${query}"`);
    const results = await searchMemories({
      userId: user.id,
      projectId: project.id,
      query,
      limit: 5,
    });
    for (const r of results) {
      console.log(
        `   ${r.score.toFixed(4)}  [${r.category}]  ${r.title}`
      );
    }

    console.log("\n▸ Project context bundle:");
    const context = await getProjectContext({
      userId: user.id,
      projectId: project.id,
    });
    console.log(
      `   ${context.counts.included}/${context.counts.total} memories · ~${context.tokenEstimate} tokens\n`
    );
    console.log(context.markdown);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("\n▸ Cleaned up throwaway user + data.");
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("\n✖ Smoke test failed:\n", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
