/**
 * `pnpm verify` — end-to-end preflight for a fresh AgentVault install.
 *
 * Answers one question: "is this deployment actually working?" It walks the
 * whole stack in dependency order and stops at the first thing that is broken,
 * telling you exactly what to fix:
 *
 *   1. Environment    — required vars present and well-formed (catches the
 *                       half-filled `.env` placeholders that look valid).
 *   2. Database       — the connection actually opens.
 *   3. Schema         — Prisma's tables exist (`pnpm db:push` was run).
 *   4. pgvector       — extension, embedding column, and index are in place.
 *   5. Embeddings     — the model loads and produces a 384-d vector.
 *   6. Round trip     — create project → save memories → semantic search →
 *                       context package, against real data, then clean up.
 *
 * Everything it creates is namespaced to a throwaway user and deleted in a
 * `finally`, so it is safe to run against a live database.
 *
 * Unit tests (`pnpm test`) cover the pure logic with no I/O; this covers the
 * parts only a real database and model can prove.
 */
import "dotenv/config";

import { getAuthMode } from "@/lib/auth-mode";
import { prisma } from "@/lib/prisma";
import { EMBEDDING_DIM, embed, warmupEmbeddings } from "@/server/embeddings";
import { createMemory } from "@/server/memories";
import { createProject } from "@/server/projects";
import { getProjectContext, searchMemories } from "@/server/search";

import { applyPgVector } from "./apply-pgvector";

/** Must match the `vector(...)` width in prisma/pgvector.sql. */
const EXPECTED_DIMS = EMBEDDING_DIM;

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

let stepNumber = 0;

function step(title: string): void {
  stepNumber += 1;
  console.log(`\n\x1b[1m${stepNumber}. ${title}\x1b[0m`);
}

function pass(message: string): void {
  console.log(`   \x1b[32m✓\x1b[0m ${message}`);
}

function info(message: string): void {
  console.log(`     \x1b[2m${message}\x1b[0m`);
}

/** Not fatal, but the operator needs to see it. Yellow, and never indented away. */
function warn(message: string): void {
  console.log(`   \x1b[33m!\x1b[0m ${message}`);
}

/** A check failed in a way the user can fix. Carries the remedy with it. */
class VerifyError extends Error {
  constructor(
    message: string,
    readonly fix: string,
  ) {
    super(message);
    this.name = "VerifyError";
  }
}

// ---------------------------------------------------------------------------
// 1. Environment
// ---------------------------------------------------------------------------

/**
 * Placeholder fragments shipped in `.env.example`. A URL containing one of
 * these parses as a valid URL but points nowhere — the most common reason a
 * fresh install fails with a confusing DNS error deep in the driver.
 */
const PLACEHOLDER_MARKERS = [
  "[REGION]",
  "[YOUR-PASSWORD]",
  "[PROJECT-REF]",
  "your-project",
  "YOUR_",
  "changeme",
];

function findPlaceholder(value: string): string | undefined {
  return PLACEHOLDER_MARKERS.find((marker) =>
    value.toLowerCase().includes(marker.toLowerCase()),
  );
}

function checkEnv(): void {
  step("Environment");

  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new VerifyError(
        `${name} is not set.`,
        `Add ${name} to .env. Copy the connection string from your Supabase ` +
          `project under Settings → Database → Connection string.`,
      );
    }

    const placeholder = findPlaceholder(value);
    if (placeholder) {
      throw new VerifyError(
        `${name} still contains the placeholder "${placeholder}".`,
        `Replace the whole ${name} value in .env with the real connection ` +
          `string from Supabase → Settings → Database. The placeholder parses ` +
          `as a valid URL, so nothing catches it until the connection fails.`,
      );
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new VerifyError(
        `${name} is not a valid URL.`,
        `It should look like postgresql://user:password@host:port/database`,
      );
    }

    if (!url.protocol.startsWith("postgres")) {
      throw new VerifyError(
        `${name} is not a postgres:// URL (got "${url.protocol}").`,
        `Use the Postgres connection string, not the Supabase project URL.`,
      );
    }

    pass(`${name} → ${url.hostname}:${url.port || "5432"}`);
  }

  // The pooled runtime URL needs the pgbouncer flag; without it Prisma's
  // prepared statements break against Supavisor in transaction mode.
  const pooled = process.env.DATABASE_URL ?? "";
  if (pooled.includes("pooler") && !pooled.includes("pgbouncer=true")) {
    info(
      "DATABASE_URL points at the pooler but has no ?pgbouncer=true flag — " +
        "add it if you hit prepared-statement errors.",
    );
  }

  checkAuthConfiguration();
}

/**
 * Auth is the one setting where "unset" is dangerous rather than merely
 * incomplete: local mode has no password, so a production deployment that falls
 * back to it is readable by anyone who finds the URL. `getAuthMode()` refuses
 * that fallback, which turns the risk into a locked-out deployment — still a
 * failure, just a safe one. Either way the operator needs to hear about it
 * here, before they ship.
 */
function checkAuthConfiguration(): void {
  const mode = getAuthMode();

  if (mode === "supabase") {
    pass("Supabase auth configured");
    return;
  }

  if (mode === "local") {
    if (process.env.NODE_ENV === "production") {
      // Explicitly opted in via NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH.
      warn(
        "Local auth mode is enabled IN PRODUCTION. Anyone who can reach this " +
          "deployment can sign in as any user, with no password. Configure " +
          "Supabase auth unless this host is private.",
      );
      if (!process.env.AMC_LOCAL_AUTH_SECRET?.trim()) {
        throw new VerifyError(
          "Local auth is enabled in production but AMC_LOCAL_AUTH_SECRET is not set.",
          "Session cookies would be signed with the committed development " +
            "secret, so anyone could forge one for any account. Set " +
            "AMC_LOCAL_AUTH_SECRET, or configure Supabase auth instead.",
        );
      }
      return;
    }
    info("Supabase auth not configured — the app will use local auth mode (dev only).");
    return;
  }

  throw new VerifyError(
    "No authentication backend is configured, so nobody can sign in.",
    "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "(Passwordless local mode is refused in production unless you set " +
      "NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH=true and AMC_LOCAL_AUTH_SECRET.)",
  );
}

// ---------------------------------------------------------------------------
// 2-4. Database, schema, pgvector
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<void> {
  step("Database connection");

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new VerifyError(
      `Could not connect to the database. ${reason}`,
      `Check that DATABASE_URL is correct and the database is reachable. If ` +
        `the host does not resolve, the project ref in the URL is wrong or ` +
        `the Supabase project was deleted/paused.`,
    );
  }

  pass("Connected");
}

async function checkSchema(): Promise<void> {
  step("Schema");

  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'api_keys', 'projects', 'memories')
  `;
  const found = new Set(rows.map((r) => r.table_name));
  const missing = ["users", "api_keys", "projects", "memories"].filter(
    (t) => !found.has(t),
  );

  if (missing.length > 0) {
    throw new VerifyError(
      `Missing table(s): ${missing.join(", ")}.`,
      `Run "pnpm db:push" to create the schema.`,
    );
  }

  pass("All 4 tables present (users, api_keys, projects, memories)");
}

async function checkPgVector(): Promise<void> {
  step("pgvector");

  // Idempotent: creates the extension, embedding column, and ANN index if the
  // database has not been set up yet.
  try {
    await applyPgVector(prisma);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new VerifyError(
      `Could not apply the pgvector schema. ${reason}`,
      `The database user may lack permission to CREATE EXTENSION. On Supabase, ` +
        `enable "vector" under Database → Extensions, then re-run.`,
    );
  }

  const [ext] = await prisma.$queryRaw<{ extversion: string }[]>`
    SELECT extversion FROM pg_extension WHERE extname = 'vector'
  `;
  if (!ext) {
    throw new VerifyError(
      "The pgvector extension is not installed.",
      `Enable "vector" under Supabase → Database → Extensions.`,
    );
  }
  pass(`Extension installed (v${ext.extversion})`);

  const [column] = await prisma.$queryRaw<{ udt_name: string }[]>`
    SELECT udt_name FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'embedding'
  `;
  if (!column) {
    throw new VerifyError(
      "The memories.embedding column is missing.",
      `Run "pnpm db:vector" to apply prisma/pgvector.sql.`,
    );
  }
  pass(`memories.embedding column present (${column.udt_name})`);
}

// ---------------------------------------------------------------------------
// 5. Embeddings
// ---------------------------------------------------------------------------

async function checkEmbeddings(): Promise<void> {
  step("Embedding model");
  info("First run downloads ~90 MB from huggingface.co — this can take a minute.");

  const started = Date.now();
  try {
    await warmupEmbeddings();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new VerifyError(
      `Could not load the embedding model. ${reason}`,
      `The model is downloaded from huggingface.co on first use. Check network ` +
        `egress, or set HF_ENDPOINT to a reachable mirror.`,
    );
  }

  const vector = await embed("verification probe");
  if (vector.length !== EXPECTED_DIMS) {
    throw new VerifyError(
      `Embedding has ${vector.length} dimensions, expected ${EXPECTED_DIMS}.`,
      `The pgvector column is vector(${EXPECTED_DIMS}); a different model would ` +
        `require a schema change in prisma/pgvector.sql.`,
    );
  }

  pass(`Loaded and produced a ${vector.length}-d vector (${Date.now() - started}ms)`);
}

// ---------------------------------------------------------------------------
// 6. Round trip
// ---------------------------------------------------------------------------

const SEED = [
  {
    title: "Money is always integer minor units",
    content:
      "Never use floats for money. Represent every amount as an integer number of minor units (cents) with an explicit ISO-4217 currency code.",
    category: "CodingStandard",
    importance: 5,
  },
  {
    title: "Event-sourced ledger",
    content:
      "All balance changes are appended as immutable events; current balances are a projection rebuilt from the event log. Chosen for auditability and full replay.",
    category: "Architecture",
    importance: 5,
  },
  {
    title: "Weekly retro on Fridays",
    content: "The team runs a retrospective every Friday afternoon.",
    category: "MeetingNotes",
    importance: 2,
  },
] as const;

async function checkRoundTrip(): Promise<void> {
  step("End-to-end round trip");

  const user = await prisma.user.create({
    data: { email: `verify+${Date.now()}@amc.local` },
  });

  try {
    const project = await createProject({
      userId: user.id,
      name: "AgentVault Verification Project",
    });
    pass(`Created project "${project.name}" (slug: ${project.slug})`);

    for (const seed of SEED) {
      await createMemory({ userId: user.id, projectId: project.id, ...seed });
    }
    pass(`Saved ${SEED.length} memories, each with a real embedding`);

    // Semantic search must beat keyword matching: the query shares no words
    // with the target memory, so a hit proves the vectors are working.
    const query = "how should we represent currency amounts?";
    const results = await searchMemories({
      userId: user.id,
      projectId: project.id,
      query,
      limit: 3,
    });

    if (results.length === 0) {
      throw new VerifyError(
        "Semantic search returned no results.",
        `Embeddings were written but the pgvector query matched nothing. ` +
          `Check that prisma/pgvector.sql was applied to THIS database.`,
      );
    }

    const top = results[0];
    pass(`Search "${query}"`);
    for (const r of results) {
      info(`${r.score.toFixed(4)}  [${r.category}]  ${r.title}`);
    }

    if (top.title !== SEED[0].title) {
      throw new VerifyError(
        `Semantic search ranked "${top.title}" first, expected "${SEED[0].title}".`,
        `Vectors are being stored but similarity ranking looks wrong. Verify ` +
          `the embedding column is vector(${EXPECTED_DIMS}) and that the ` +
          `cosine operator (<=>) is used in src/server/search.ts.`,
      );
    }
    pass("Top result is the semantically closest memory (not a keyword match)");

    const context = await getProjectContext({
      userId: user.id,
      projectId: project.id,
    });

    if (context.counts.included === 0) {
      throw new VerifyError(
        "The context package came back empty.",
        `Memories were saved but none were selected for the context bundle.`,
      );
    }

    // Priority categories must lead the package — that ordering is the whole
    // point of the context builder.
    if (!context.groups[0]?.priority) {
      throw new VerifyError(
        `Context package leads with "${context.groups[0]?.category}", which is ` +
          `not a priority category.`,
        `Check PRIORITY_CATEGORIES in src/lib/categories.ts.`,
      );
    }

    pass(
      `Context package: ${context.counts.included}/${context.counts.total} memories, ` +
        `~${context.tokenEstimate} tokens, leads with ${context.groups[0].category}`,
    );
  } finally {
    // Cascades to the project and its memories.
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    pass("Cleaned up all verification data");
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n\x1b[1mAgentVault — verification\x1b[0m");

  checkEnv();
  await checkDatabase();
  await checkSchema();
  await checkPgVector();
  await checkEmbeddings();
  await checkRoundTrip();

  console.log(
    "\n\x1b[32m\x1b[1m✓ All checks passed.\x1b[0m Your AgentVault install is working end to end.",
  );
  console.log(
    "\x1b[2m  Next: run `pnpm dev`, create an API key under Settings → API Keys,\x1b[0m",
  );
  console.log(
    "\x1b[2m  and point your agent at it with the amc-mcp server.\x1b[0m\n",
  );
}

main()
  .catch((err) => {
    if (err instanceof VerifyError) {
      console.error(`\n   \x1b[31m✗ ${err.message}\x1b[0m`);
      console.error(`\n   \x1b[33mHow to fix:\x1b[0m ${err.fix}\n`);
    } else {
      console.error("\n\x1b[31m✗ Verification failed with an unexpected error:\x1b[0m\n");
      console.error(err);
      console.error();
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
