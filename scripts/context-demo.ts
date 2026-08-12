/**
 * Demo: build a project context package from a mixed-category memory set and
 * print both the structured summary and the injectable markdown.
 *
 * Run (from repo root):
 *   pnpm exec tsc -p tsconfig.demo.json && node scripts/run-demo.cjs
 */
import { buildProjectContext, type ContextMemoryInput } from "@/server/context";

const d = (iso: string) => new Date(iso);

const memories: ContextMemoryInput[] = [
  // --- Priority categories (always lead the package) ---
  {
    id: "m1",
    category: "Architecture",
    importance: 5,
    updatedAt: d("2026-07-10T09:00:00Z"),
    title: "Two-connection Postgres setup (pooled + direct)",
    content:
      "App runtime uses the pooled DATABASE_URL (Supabase pgBouncer). Migrations use the direct DIRECT_URL. Never run migrations through the pooler — prepared-statement errors will result.",
  },
  {
    id: "m2",
    category: "Architecture",
    importance: 3,
    updatedAt: d("2026-06-28T12:00:00Z"),
    title: "Embeddings stored as pgvector(384), queried via raw SQL",
    content:
      "The `embedding vector(384)` column on `memories` is not modeled in Prisma (no native vector type). It is added by a manual SQL migration and queried with raw SQL for similarity search.",
  },
  {
    id: "m3",
    category: "TechnicalDecision",
    importance: 5,
    updatedAt: d("2026-07-11T15:30:00Z"),
    title: "Pin Next.js to 15.5.20 (not 16)",
    content:
      "create-next-app installed Next 16, but the project requires the 15.x App Router line. Pinned to 15.5.20. Reinstall with `next@15`. Revisit when 16 is validated against turbopack build.",
  },
  {
    id: "m4",
    category: "CodingStandard",
    importance: 4,
    updatedAt: d("2026-07-05T08:00:00Z"),
    title: "Category & importance come from @/lib/categories only",
    content:
      "Never hardcode the category list or importance labels. Import MEMORY_CATEGORIES, memoryCategorySchema, importanceSchema from @/lib/categories so forms, filters, API validation and badges stay in sync.",
  },
  {
    id: "m5",
    category: "DevelopmentPreference",
    importance: 3,
    updatedAt: d("2026-07-02T10:00:00Z"),
    title: "Use pnpm; dev server runs with turbopack",
    content: "Package manager is pnpm. `pnpm dev` runs `next dev --turbopack`. No new infra without discussion.",
  },

  // --- Other categories: high-importance recent items get in ---
  {
    id: "m6",
    category: "SecurityNote",
    importance: 5,
    updatedAt: d("2026-07-09T18:00:00Z"),
    title: "API keys stored hashed, never in plaintext",
    content:
      "ApiKey.keyHash holds a hash only. Compare by hashing the presented key; the raw key is shown to the user exactly once at creation and never persisted.",
  },
  {
    id: "m7",
    category: "ApiReference",
    importance: 4,
    updatedAt: d("2026-07-08T11:00:00Z"),
    title: "GET /api/projects/:id/context returns the injectable package",
    content:
      "Returns ProjectContext: { projectId, generatedAt, tokenBudget, tokenEstimate, counts, groups, markdown }. Agents inject the `markdown` field directly.",
  },
  {
    id: "m8",
    category: "BugFix",
    importance: 4,
    updatedAt: d("2026-07-11T09:45:00Z"),
    title: "Fixed workspace-root misdetection breaking build",
    content:
      "A stray C:/Users/user/pnpm-lock.yaml made Next infer the wrong workspace root. Set outputFileTracingRoot to the project dir in next.config.ts.",
  },
  {
    id: "m9",
    category: "Configuration",
    importance: 3,
    updatedAt: d("2026-06-30T14:00:00Z"),
    title: ".gitignore keeps .env.example tracked",
    content: "Changed `.env*` to `.env` + `.env.*` + `!.env.example` so the example commits while real env files stay ignored.",
  },
  {
    id: "m10",
    category: "Research",
    importance: 4,
    updatedAt: d("2026-07-01T16:00:00Z"),
    title: "Very long note that should be truncated per-item",
    content: ("Findings on chunking strategy. " + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(60)).trim(),
  },

  // --- Should be EXCLUDED: low-importance, non-priority (below minOtherImportance=3) ---
  {
    id: "m11",
    category: "Task",
    importance: 2,
    updatedAt: d("2026-07-12T08:00:00Z"),
    title: "Rename a variable in the sidebar",
    content: "Low-priority chore, not worth injecting into agent context.",
  },
  {
    id: "m12",
    category: "General",
    importance: 1,
    updatedAt: d("2026-07-12T09:00:00Z"),
    title: "Team offsite is next month",
    content: "Not relevant to coding context.",
  },
];

function section(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

// 1) Full package at the default ~2000-token budget.
const ctx = buildProjectContext(memories, {
  projectId: "amc-web",
  generatedAt: d("2026-07-12T12:00:00Z"),
});

section("STRUCTURED SUMMARY (default budget 2000)");
console.log(
  JSON.stringify(
    {
      projectId: ctx.projectId,
      tokenBudget: ctx.tokenBudget,
      tokenEstimate: ctx.tokenEstimate,
      counts: ctx.counts,
      groups: ctx.groups.map((g) => ({
        category: g.category,
        priority: g.priority,
        items: g.items.map((i) => ({
          id: i.id,
          importance: i.importance,
          truncated: i.truncated,
          title: i.title,
        })),
      })),
    },
    null,
    2,
  ),
);

section("INJECTABLE MARKDOWN (ctx.markdown)");
console.log(ctx.markdown);

// 2) Same memories under a tight budget to show the size cap packing/omitting.
const tight = buildProjectContext(memories, {
  projectId: "amc-web",
  generatedAt: d("2026-07-12T12:00:00Z"),
  tokenBudget: 500,
});
section("TIGHT BUDGET (500 tokens) — cap drops lower-ranked items");
console.log(
  JSON.stringify(
    { counts: tight.counts, tokenEstimate: tight.tokenEstimate, included: tight.groups.flatMap((g) => g.items.map((i) => i.title)) },
    null,
    2,
  ),
);
