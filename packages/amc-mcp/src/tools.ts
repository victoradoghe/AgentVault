/**
 * MCP tool definitions for AgentVault.
 *
 * Each tool wraps one AgentVault REST endpoint.
 *
 * TOKEN BUDGET — this file is performance-critical for the *calling* agent:
 *
 *   1. Tool definitions (name + description + schema) are re-sent to the model
 *      on EVERY turn, so prose here is a per-request tax. Descriptions keep only
 *      the behavioural nudges that change what an agent does ("call this at the
 *      start of a task", "call this when a decision is made") and drop
 *      restatements of what the schema already says.
 *   2. Tool *results* are returned as compact text, not pretty-printed JSON.
 *      `JSON.stringify(x, null, 2)` spends a third of its tokens on whitespace
 *      and repeats every key on every item.
 *   3. `list_memories` returns titles WITHOUT bodies (browsing rarely needs
 *      them), and `search_memory` truncates long bodies. Full curated content
 *      comes from `get_project_context`.
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

/**
 * Longest memory body returned by `search_memory`, in characters (~150 tokens).
 * Most memories fit well inside this, so truncation is rare; the cap only stops
 * one long memory from swamping an agent's context.
 */
const SNIPPET_CHARS = 600;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wraps a handler so any thrown AmcError becomes a clean, agent-readable message. */
function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch((err): ToolResult => {
    if (err instanceof AmcError) {
      const hint = err.retriable ? " (transient — you can retry this call)" : "";
      return {
        content: [{ type: "text", text: `Error: ${err.message}${hint}` }],
        isError: true,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Unexpected error: ${message}` }], isError: true };
  });
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Truncate on a word boundary, flagging that the body was shortened. */
function snippet(text: string, max = SNIPPET_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}… [truncated]`;
}

/** One-line header shared by search and list renderings. */
function headline(m: Memory): string {
  const bits = [m.category, m.importance !== undefined ? `i${m.importance}` : null]
    .filter(Boolean)
    .join(" ");
  return `${m.title}${bits ? ` (${bits})` : ""}`;
}

export function registerTools(server: McpServer, client: AmcClient): void {
  server.registerTool(
    "list_projects",
    {
      title: "List memory projects",
      description:
        "List the memory projects this API key can access. Use it to find a " +
        "project_slug when you don't already know one.",
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const projects = await client.listProjects();
        if (projects.length === 0) {
          return ok(
            "No projects yet. Create one in the AgentVault dashboard, then use its slug.",
          );
        }
        return ok(
          projects
            .map(
              (p) =>
                `${p.slug}  ${p.name}` +
                (p.memoryCount !== undefined ? `  (${p.memoryCount})` : ""),
            )
            .join("\n"),
        );
      }),
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Load project memory",
      description:
        "Load a project's curated memory as markdown. CALL THIS AT THE START OF " +
        "A TASK, before planning or writing code, so you inherit prior decisions, " +
        "conventions, and gotchas instead of starting cold. Read it in full.",
      inputSchema: {
        project_slug: z.string().min(1),
      },
    },
    ({ project_slug }) =>
      guard(async () => {
        const markdown = await client.getProjectContext(project_slug);
        if (!markdown.trim()) {
          return ok(
            `Project "${project_slug}" has no memories yet. Use save_memory as decisions are made.`,
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
        "Semantic search over a project's memories. Use for targeted recall " +
        "mid-task; use get_project_context for the whole picture. Long bodies are " +
        "truncated.",
      inputSchema: {
        project_slug: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    ({ project_slug, query, limit }) =>
      guard(async () => {
        const results = await client.searchMemory(project_slug, query, limit);
        if (results.length === 0) {
          return ok(`No memories matched "${query}" in "${project_slug}".`);
        }
        return ok(
          results
            .map((m) => {
              const score = m.score !== undefined ? `[${m.score.toFixed(2)}] ` : "";
              return `${score}${headline(m)}\n${snippet(m.content)}\nid: ${m.id}`;
            })
            .join("\n\n"),
        );
      }),
  );

  server.registerTool(
    "save_memory",
    {
      title: "Save a memory",
      description:
        "Save a durable fact so future sessions inherit it. CALL THIS WHENEVER AN " +
        "IMPORTANT DECISION IS MADE — an architectural choice, a convention, a " +
        "non-obvious constraint, a fix that worked, a hard-won gotcha. Include the " +
        "WHY, keep it self-contained, and never save secrets or transient chatter.",
      inputSchema: {
        project_slug: z.string().min(1),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(20_000),
        category: z.enum(MEMORY_CATEGORIES).optional(),
        importance: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("1–5, 5 = critical. Default 3."),
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
        return ok(`Saved "${saved.title ?? title}"${saved.id ? ` (${saved.id})` : ""}.`);
      }),
  );

  server.registerTool(
    "list_memories",
    {
      title: "List project memories",
      description:
        "List a project's memory titles, optionally by category. Bodies are NOT " +
        "included — use search_memory to read content, or get_project_context for " +
        "the curated bundle.",
      inputSchema: {
        project_slug: z.string().min(1),
        category: z.enum(MEMORY_CATEGORIES).optional(),
      },
    },
    ({ project_slug, category }) =>
      guard(async () => {
        const memories = await client.listMemories(project_slug, category);
        if (memories.length === 0) {
          return ok(
            `No memories${category ? ` in "${category}"` : ""} for "${project_slug}".`,
          );
        }
        return ok(memories.map((m) => `${m.id}  ${headline(m)}`).join("\n"));
      }),
  );

  server.registerTool(
    "delete_memory",
    {
      title: "Delete a memory",
      description:
        "Permanently delete one memory by id (ids come from list_memories or " +
        "search_memory). Cannot be undone.",
      inputSchema: {
        memory_id: z.string().min(1),
      },
    },
    ({ memory_id }) =>
      guard(async () => {
        await client.deleteMemory(memory_id);
        return ok(`Deleted ${memory_id}.`);
      }),
  );
}
