/**
 * Project context builder.
 *
 * Turns a project's raw memories into a compact, well-structured "context
 * package" that an agent can inject straight into its working context.
 *
 * Two shapes are returned side by side:
 *   - a structured object (`ProjectContext`) for programmatic use, and
 *   - a pre-formatted markdown string (`ProjectContext.markdown`) that an agent
 *     can drop verbatim into a system/context prompt.
 *
 * Selection strategy (see `buildProjectContext`):
 *   1. Priority categories first — Architecture, TechnicalDecision,
 *      CodingStandard, DevelopmentPreference — ranked by importance then
 *      recency. These describe the durable shape of the project.
 *   2. Then the most-recent, high-importance items from every other category.
 *   3. Everything is packed greedily under a total token budget (~2000 by
 *      default) so the result always stays injectable. Overlong memories are
 *      truncated per item; items that don't fit are omitted and counted.
 *
 * The core (`buildProjectContext`) is a PURE function over an array of
 * memories — no database, no Prisma, no I/O — so it is trivial to test and
 * demo. `getProjectContext` is a thin async wrapper that takes an injected
 * `listMemories` fetcher, keeping this module decoupled from the data layer.
 */
import {
  CATEGORY_META,
  MEMORY_CATEGORIES,
  PRIORITY_CATEGORIES,
  importanceLabel,
  isPriorityCategory,
  type MemoryCategory,
} from "@/lib/categories";

/** A memory as consumed by the context builder. */
export interface ContextMemoryInput {
  id: string;
  title: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  updatedAt: Date | string;
  /** Optional moderation status; only "approved" memories are included. */
  status?: string;
}

/** A single memory that made it into the package (content may be truncated). */
export interface ContextItem {
  id: string;
  title: string;
  content: string;
  importance: number;
  updatedAt: string;
  /** True when `content` was shortened to fit the per-item cap. */
  truncated: boolean;
}

/** Memories that share a category, in the package's group ordering. */
export interface ContextGroup {
  category: MemoryCategory;
  label: string;
  priority: boolean;
  items: ContextItem[];
}

/** The full structured context package. */
export interface ProjectContext {
  projectId: string;
  generatedAt: string;
  tokenBudget: number;
  /** Estimated token size of `markdown` (chars / 4, rounded up). */
  tokenEstimate: number;
  counts: {
    /** Total approved memories considered. */
    total: number;
    /** Memories included in the package. */
    included: number;
    /** Memories dropped because the budget was exhausted. */
    omitted: number;
  };
  groups: ContextGroup[];
  /** Ready-to-inject markdown rendering of `groups`. */
  markdown: string;
}

export interface BuildContextOptions {
  projectId?: string;
  /** Total token budget for the package. Default 2000. */
  tokenBudget?: number;
  /** Max tokens of a single memory's content before it's truncated. Default 480. */
  perItemTokenCap?: number;
  /**
   * Minimum importance for a NON-priority memory to be eligible. Priority
   * categories are always eligible regardless. Default 3.
   */
  minOtherImportance?: number;
  /** Injectable clock for deterministic output (tests/demos). */
  generatedAt?: Date;
}

const DEFAULTS = {
  tokenBudget: 2000,
  perItemTokenCap: 480,
  minOtherImportance: 3,
} as const;

/** Rough token estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function timeValue(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Sort by importance (desc), then most-recent (desc), then title for stability. */
function byImportanceThenRecency(
  a: ContextMemoryInput,
  b: ContextMemoryInput,
): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  const t = timeValue(b.updatedAt) - timeValue(a.updatedAt);
  if (t !== 0) return t;
  return a.title.localeCompare(b.title);
}

/** Shorten content to a token cap on a word boundary; flag if we cut it. */
function capContent(
  content: string,
  perItemTokenCap: number,
): { content: string; truncated: boolean } {
  if (estimateTokens(content) <= perItemTokenCap) {
    return { content, truncated: false };
  }
  const maxChars = perItemTokenCap * 4;
  let slice = content.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.6) slice = slice.slice(0, lastSpace);
  return { content: `${slice.trimEnd()}…`, truncated: true };
}

/** Render one memory as a markdown block. */
function renderItem(item: ContextItem): string {
  const flag = item.truncated ? " · truncated" : "";
  return `### ${item.title}\n_importance ${importanceLabel(item.importance)}${flag}_\n\n${item.content}`;
}

/** Canonical group ordering: priority categories first, then the rest. */
const GROUP_ORDER: MemoryCategory[] = [
  ...PRIORITY_CATEGORIES,
  ...MEMORY_CATEGORIES.filter((c) => !isPriorityCategory(c)),
];

/**
 * Build a size-capped, grouped context package from a project's memories.
 * Pure and synchronous — no I/O.
 */
export function buildProjectContext(
  memories: ContextMemoryInput[],
  options: BuildContextOptions = {},
): ProjectContext {
  const projectId = options.projectId ?? "unknown";
  const tokenBudget = options.tokenBudget ?? DEFAULTS.tokenBudget;
  const perItemTokenCap = options.perItemTokenCap ?? DEFAULTS.perItemTokenCap;
  const minOtherImportance =
    options.minOtherImportance ?? DEFAULTS.minOtherImportance;
  const generatedAt = options.generatedAt ?? new Date();

  const approved = memories.filter((m) => (m.status ?? "approved") === "approved");

  // Rank pool: all priority-category memories first (any importance), then
  // eligible non-priority memories. Both passes ranked importance→recency.
  const priorityPool = approved
    .filter((m) => isPriorityCategory(m.category))
    .sort(byImportanceThenRecency);
  const otherPool = approved
    .filter(
      (m) => !isPriorityCategory(m.category) && m.importance >= minOtherImportance,
    )
    .sort(byImportanceThenRecency);
  const rankedPool = [...priorityPool, ...otherPool];

  // Greedy pack under the token budget. The header block is charged first so
  // the estimate reflects the real injectable size.
  const headerReserve = 48;
  let used = headerReserve;
  const chosen: { category: MemoryCategory; item: ContextItem }[] = [];

  for (const m of rankedPool) {
    const { content, truncated } = capContent(m.content, perItemTokenCap);
    const item: ContextItem = {
      id: m.id,
      title: m.title,
      content,
      importance: m.importance,
      updatedAt: toIso(m.updatedAt),
      truncated,
    };
    const cost = estimateTokens(renderItem(item)) + 4; // +4 for block spacing
    if (used + cost > tokenBudget) continue; // skip; a smaller later item may fit
    used += cost;
    chosen.push({ category: m.category, item });
  }

  // Group chosen items by category in canonical group order.
  const groups: ContextGroup[] = [];
  for (const category of GROUP_ORDER) {
    const items = chosen
      .filter((c) => c.category === category)
      .map((c) => c.item)
      .sort((a, b) =>
        b.importance !== a.importance
          ? b.importance - a.importance
          : timeValue(b.updatedAt) - timeValue(a.updatedAt),
      );
    if (items.length === 0) continue;
    groups.push({
      category,
      label: CATEGORY_META[category].label,
      priority: isPriorityCategory(category),
      items,
    });
  }

  const markdown = renderMarkdown({
    projectId,
    generatedAt,
    groups,
    total: approved.length,
    included: chosen.length,
    tokenBudget,
  });

  return {
    projectId,
    generatedAt: generatedAt.toISOString(),
    tokenBudget,
    tokenEstimate: estimateTokens(markdown),
    counts: {
      total: approved.length,
      included: chosen.length,
      omitted: approved.length - chosen.length,
    },
    groups,
    markdown,
  };
}

function renderMarkdown(args: {
  projectId: string;
  generatedAt: Date;
  groups: ContextGroup[];
  total: number;
  included: number;
  tokenBudget: number;
}): string {
  const { projectId, generatedAt, groups, total, included, tokenBudget } = args;

  const lines: string[] = [];
  lines.push(`# Project Context: ${projectId}`);
  lines.push(
    `_${included} of ${total} memories · budget ${tokenBudget} tokens · generated ${generatedAt.toISOString()}_`,
  );

  if (groups.length === 0) {
    lines.push("");
    lines.push("_No memories available for this project yet._");
    return lines.join("\n");
  }

  for (const group of groups) {
    lines.push("");
    const marker = group.priority ? " ⭐" : "";
    lines.push(`## ${group.label}${marker}`);
    for (const item of group.items) {
      lines.push("");
      lines.push(renderItem(item));
    }
  }

  return lines.join("\n");
}

/** Data-access seam: how the builder gets a project's memories. */
export interface ContextDeps {
  listMemories: (projectId: string) => Promise<ContextMemoryInput[]>;
}

/**
 * Fetch a project's memories (via the injected `listMemories`) and build its
 * context package. The API route supplies a Prisma-backed `listMemories`;
 * tests supply an in-memory one. This keeps the builder free of DB coupling.
 */
export async function getProjectContext(
  projectId: string,
  deps: ContextDeps,
  options: Omit<BuildContextOptions, "projectId"> = {},
): Promise<ProjectContext> {
  const memories = await deps.listMemories(projectId);
  return buildProjectContext(memories, { ...options, projectId });
}
