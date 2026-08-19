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
import { AmcError, type Memory } from "./client.js";
import type { OfflineClient } from "./offline.js";

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

/**
 * Prefix marking a result as served from the offline cache.
 *
 * The agent has to know this: it is about to plan work against decisions that
 * may have moved on, and it should say so to the user rather than presenting a
 * three-day-old snapshot as the current state of the project. Kept to one line
 * — it is paid for on every offline call, and the age is the part that matters.
 */
function offlineNote(cachedAt: number | null): string {
  if (cachedAt === null) return "";
  return `[offline — cached ${describeAge(cachedAt)}; the server may have newer memories]\n\n`;
}

/** Compact, human-readable age, e.g. "12m ago". */
function describeAge(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Trailing note about writes still waiting to sync. */
function pendingNote(pending: number): string {
  if (pending <= 0) return "";
  return `\n(${pending} write${pending === 1 ? "" : "s"} queued locally, syncing when the connection returns.)`;
}

export function registerTools(server: McpServer, client: OfflineClient): void {
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
        const { data: projects, cachedAt } = await client.listProjects();
        if (projects.length === 0) {
          return ok(
            "No projects yet. Create one in the AgentVault dashboard, then use its slug.",
          );
        }
        return ok(
          offlineNote(cachedAt) +
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
        const { data: markdown, cachedAt } = await client.getProjectContext(project_slug);
        if (!markdown.trim()) {
          return ok(
            `Project "${project_slug}" has no memories yet. Use save_memory as decisions are made.`,
          );
        }
        return ok(offlineNote(cachedAt) + markdown);
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
        const { data: results, cachedAt, degraded } = await client.searchMemory(
          project_slug,
          query,
          limit,
        );

        // Offline search is a keyword scan, not the server's vector search, so
        // say so: an agent that assumes semantic matching would read an empty
        // result as "nothing relevant exists" rather than "no literal match".
        const header = degraded
          ? `[offline — keyword search over memories cached ${describeAge(cachedAt ?? Date.now())}; ` +
            `not semantic, so phrasing matters]\n\n`
          : offlineNote(cachedAt);

        if (results.length === 0) {
          return ok(
            `${header}No memories matched "${query}" in "${project_slug}".` +
              (degraded ? " Try different words, or get_project_context for everything cached." : ""),
          );
        }
        return ok(
          header +
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
        const outcome = await client.saveMemory({
          projectSlug: project_slug,
          title,
          content,
          category,
          importance,
        });

        if (outcome.status === "queued") {
          // Explicitly a success, not an error: the memory is durably on disk
          // and will sync. Saying "failed" here invites the agent to retry and
          // create duplicates, or to give up and drop the fact entirely.
          return ok(
            `Saved "${title}" locally (${outcome.localId}) — the server is unreachable, ` +
              `so it is queued and will sync automatically on the next successful call. ` +
              `No need to retry.${pendingNote(outcome.pending - 1)}`,
          );
        }

        const saved = outcome.memory;
        return ok(
          `Saved "${saved?.title ?? title}"${saved?.id ? ` (${saved.id})` : ""}.` +
            pendingNote(outcome.pending),
        );
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
        const { data: memories, cachedAt } = await client.listMemories(
          project_slug,
          category,
        );
        if (memories.length === 0) {
          return ok(
            `${offlineNote(cachedAt)}No memories${category ? ` in "${category}"` : ""} for "${project_slug}".`,
          );
        }
        return ok(
          offlineNote(cachedAt) +
            memories.map((m) => `${m.id}  ${headline(m)}`).join("\n"),
        );
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
        const outcome = await client.deleteMemory(memory_id);

        if (outcome.status === "unqueued") {
          return ok(
            `Discarded ${memory_id} — it was still queued offline, so it never reached the server.`,
          );
        }
        if (outcome.status === "queued") {
          return ok(
            `Queued the deletion of ${memory_id} — the server is unreachable. It will be ` +
              `applied automatically on the next successful call.${pendingNote(outcome.pending - 1)}`,
          );
        }
        return ok(`Deleted ${memory_id}.${pendingNote(outcome.pending)}`);
      }),
  );
}
