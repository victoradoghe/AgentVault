/**
 * MCP tool definitions for AgentVault.
 *
 * Each tool wraps one AgentVault REST endpoint. Descriptions are written for the
 * *calling agent* — they explain when to reach for the tool, not just what it
 * does — and deliberately nudge the agent to load context at the start of a
 * task and to save memories when meaningful decisions are made.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AmcClient, AmcError, type Memory } from "./client.js";

/**
 * The closed memory taxonomy. This MUST stay in sync with the server's single
 * source of truth at `src/lib/categories.ts` (MEMORY_CATEGORIES). It is copied
 * here rather than imported so this package stays standalone and publishable —
 * the API validates categories server-side, so mirroring the enum just gives
 * agents better up-front schemas and error messages.
 */
const MEMORY_CATEGORIES = [
  "Architecture",
  "TechnicalDecision",
  "BugReport",
  "BugFix",
  "Documentation",
  "ApiReference",
  "Configuration",
  "Task",
  "MeetingNotes",
  "Research",
  "CodingStandard",
  "DevelopmentPreference",
  "SecurityNote",
  "General",
] as const;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wraps a handler so any thrown AmcError becomes a clean, agent-readable message. */
function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch((err): ToolResult => {
    if (err instanceof AmcError) {
      const hint = err.retriable
        ? " (transient — you can retry this call)"
        : "";
      return { content: [{ type: "text", text: `Error: ${err.message}${hint}` }], isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Unexpected error: ${message}` }], isError: true };
  });
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function json(value: unknown): ToolResult {
  return ok(JSON.stringify(value, null, 2));
}

/** Compact, human/agent-friendly rendering of a memory. */
function formatMemory(m: Memory): Record<string, unknown> {
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    category: m.category,
    importance: m.importance,
    ...(m.score !== undefined ? { score: Number(m.score.toFixed(4)) } : {}),
    ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
  };
}

export function registerTools(server: McpServer, client: AmcClient): void {
  server.registerTool(
    "list_projects",
    {
      title: "List memory projects",
      description:
        "List all AgentVault projects available to your API key. Each " +
        "project is an isolated memory space (usually one per codebase/repo). " +
        "Use this to discover the correct `project_slug` before calling other " +
        "tools when you are unsure which project to use.",
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const projects = await client.listProjects();
        if (projects.length === 0) {
          return ok(
            "No projects found for this API key. Create one in the Agent Memory " +
              "Cloud dashboard, then use its slug with the other tools.",
          );
        }
        return json(
          projects.map((p) => ({
            name: p.name,
            slug: p.slug,
            ...(p.memoryCount !== undefined ? { memoryCount: p.memoryCount } : {}),
          })),
        );
      }),
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Load project memory (context bundle)",
      description:
        "Load the full memory context bundle for a project as markdown. THIS IS " +
        "THE PRIMARY 'LOAD MY MEMORY' TOOL — call it at the START of a task, " +
        "before you begin planning or writing code, so you inherit prior " +
        "decisions, conventions, and gotchas instead of starting cold. The " +
        "bundle is curated (most important / most relevant memories first) and " +
        "meant to be read in full. If you don't know the slug, call list_projects first.",
      inputSchema: {
        project_slug: z
          .string()
          .min(1)
          .describe("The project's slug, e.g. \"my-app\" (from list_projects)."),
      },
    },
    ({ project_slug }) =>
      guard(async () => {
        const markdown = await client.getProjectContext(project_slug);
        if (!markdown.trim()) {
          return ok(
            `Project "${project_slug}" has no memories yet. As you make important ` +
              "decisions, use save_memory to build up its context.",
          );
        }
        return ok(markdown);
      }),
  );

  server.registerTool(
    "search_memory",
    {
      title: "Search project memory",
      description:
        "Semantic search over a project's memories for a specific question or " +
        "topic. Use this when you need targeted recall mid-task (e.g. \"how is " +
        "auth handled?\", \"why did we pick Prisma?\") rather than the whole " +
        "context bundle. Returns the most relevant memories with similarity scores.",
      inputSchema: {
        project_slug: z.string().min(1).describe("The project's slug."),
        query: z.string().min(1).describe("Natural-language search query."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results to return (default server-side, e.g. 10)."),
      },
    },
    ({ project_slug, query, limit }) =>
      guard(async () => {
        const results = await client.searchMemory(project_slug, query, limit);
        if (results.length === 0) {
          return ok(`No memories matched "${query}" in project "${project_slug}".`);
        }
        return json(results.map(formatMemory));
      }),
  );

  server.registerTool(
    "save_memory",
    {
      title: "Save a memory",
      description:
        "Persist an important, durable fact to a project's memory so future " +
        "sessions (yours or another agent's) inherit it. CALL THIS WHENEVER AN " +
        "IMPORTANT DECISION IS MADE — an architectural choice and its rationale, " +
        "a convention, a non-obvious constraint, a fix that worked, or a hard-won " +
        "gotcha. Prefer a specific title and self-contained content; don't save " +
        "transient chatter or secrets. Categories help organise recall.",
      inputSchema: {
        project_slug: z.string().min(1).describe("The project's slug."),
        title: z
          .string()
          .min(1)
          .max(200)
          .describe("Short, specific title for the memory (max 200 chars)."),
        content: z
          .string()
          .min(1)
          .max(20_000)
          .describe("The fact to remember, self-contained. Include the WHY for decisions."),
        category: z
          .enum(MEMORY_CATEGORIES)
          .optional()
          .describe(
            "Optional category from the fixed taxonomy. Use \"TechnicalDecision\" for " +
              "a choice + rationale, \"Architecture\" for system shape, \"CodingStandard\" " +
              "for conventions, \"BugFix\"/\"BugReport\", \"Configuration\", \"SecurityNote\", " +
              "etc. Defaults server-side to \"General\".",
          ),
        importance: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe(
            "Optional 1–5: 1 Low, 2 Minor, 3 Moderate, 4 High, 5 Critical. " +
              "Defaults server-side to 3.",
          ),
      },
    },
    ({ project_slug, title, content, category, importance }) =>
      guard(async () => {
        const saved = await client.saveMemory({
          projectSlug: project_slug,
          title,
          content,
          category,
          importance,
        });
        return ok(
          `Saved memory "${saved.title ?? title}"` +
            (saved.id ? ` (id: ${saved.id})` : "") +
            ` to project "${project_slug}".`,
        );
      }),
  );

  server.registerTool(
    "list_memories",
    {
      title: "List project memories",
      description:
        "List a project's saved memories, optionally filtered by category. Use " +
        "this to browse or audit what has been remembered (e.g. before deleting " +
        "a stale memory). For finding memories about a topic, prefer search_memory.",
      inputSchema: {
        project_slug: z.string().min(1).describe("The project's slug."),
        category: z
          .enum(MEMORY_CATEGORIES)
          .optional()
          .describe("Optional category filter from the fixed taxonomy, e.g. \"Architecture\"."),
      },
    },
    ({ project_slug, category }) =>
      guard(async () => {
        const memories = await client.listMemories(project_slug, category);
        if (memories.length === 0) {
          return ok(
            `No memories${category ? ` in category "${category}"` : ""} for project ` +
              `"${project_slug}".`,
          );
        }
        return json(memories.map(formatMemory));
      }),
  );

  server.registerTool(
    "delete_memory",
    {
      title: "Delete a memory",
      description:
        "Permanently delete a single memory by its id (obtain ids from " +
        "list_memories or search_memory). Use when a memory is wrong, obsolete, " +
        "or a duplicate. This cannot be undone.",
      inputSchema: {
        memory_id: z.string().min(1).describe("The id of the memory to delete."),
      },
    },
    ({ memory_id }) =>
      guard(async () => {
        await client.deleteMemory(memory_id);
        return ok(`Deleted memory ${memory_id}.`);
      }),
  );
}
