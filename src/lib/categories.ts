/**
 * The fixed memory taxonomy for AgentVault.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the category set and the
 * importance scale. Forms, API validation, table filters, badges, and the
 * context builder all import from here so the set can never drift.
 *
 * Safe to import from both client and server code (no server-only deps).
 */
import { z } from "zod";

/**
 * The closed set of memory categories, in canonical display order.
 * Adding/removing a category is a one-line change here that ripples
 * everywhere through the exports below.
 */
export const MEMORY_CATEGORIES = [
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

/** Union of every valid category value, e.g. `"Architecture" | "BugFix" | ...`. */
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Enum-style value object for ergonomic references in code
 * (`MemoryCategory.Architecture`) without a non-erasable TS `enum`.
 * Merges with the `MemoryCategory` type above.
 */
export const MemoryCategory = Object.freeze(
  Object.fromEntries(MEMORY_CATEGORIES.map((c) => [c, c])),
) as { readonly [K in MemoryCategory]: K };

/** Zod enum for request/form validation. Rejects any value outside the set. */
export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES);

/** Default category applied when none is supplied. Mirrors the Prisma default. */
export const DEFAULT_CATEGORY: MemoryCategory = "General";

/**
 * Categories that always lead a context package. These describe the durable
 * shape of a project (how it's built, why, and the rules for working in it),
 * so agents benefit most from having them injected first.
 */
export const PRIORITY_CATEGORIES = [
  "Architecture",
  "TechnicalDecision",
  "CodingStandard",
  "DevelopmentPreference",
] as const satisfies readonly MemoryCategory[];

const PRIORITY_SET: ReadonlySet<MemoryCategory> = new Set(PRIORITY_CATEGORIES);

/** True when a category is one of the always-first priority categories. */
export function isPriorityCategory(category: MemoryCategory): boolean {
  return PRIORITY_SET.has(category);
}

export interface CategoryMeta {
  /** Human-friendly label for UI. */
  label: string;
  /** One-line description shown as a tooltip / help text. */
  description: string;
  /**
   * Tailwind classes giving each category a distinct, theme-aware badge color.
   * Applied on top of the `outline` Badge variant.
   */
  badgeClass: string;
}

/**
 * Per-category presentation metadata. Colors are deliberately spread across the
 * hue wheel so adjacent rows in a table stay easy to tell apart.
 */
export const CATEGORY_META: Record<MemoryCategory, CategoryMeta> = {
  Architecture: {
    label: "Architecture",
    description: "System shape, boundaries, and how major pieces fit together.",
    badgeClass:
      "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900",
  },
  TechnicalDecision: {
    label: "Technical Decision",
    description: "A choice made between alternatives, with its rationale.",
    badgeClass:
      "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900",
  },
  BugReport: {
    label: "Bug Report",
    description: "A reproducible defect and the conditions that trigger it.",
    badgeClass:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
  },
  BugFix: {
    label: "Bug Fix",
    description: "How a defect was resolved and why the fix works.",
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  },
  Documentation: {
    label: "Documentation",
    description: "Explanatory notes, guides, and how-tos.",
    badgeClass:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  },
  ApiReference: {
    label: "API Reference",
    description: "Endpoint contracts, payload shapes, and integration details.",
    badgeClass:
      "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-900",
  },
  Configuration: {
    label: "Configuration",
    description: "Environment, build, and deployment settings.",
    badgeClass:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  },
  Task: {
    label: "Task",
    description: "Actionable work items and their current state.",
    badgeClass:
      "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900",
  },
  MeetingNotes: {
    label: "Meeting Notes",
    description: "Discussion outcomes and follow-ups.",
    badgeClass:
      "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-900",
  },
  Research: {
    label: "Research",
    description: "Investigations, findings, and reference material.",
    badgeClass:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900",
  },
  CodingStandard: {
    label: "Coding Standard",
    description: "Conventions the codebase must follow.",
    badgeClass:
      "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900",
  },
  DevelopmentPreference: {
    label: "Development Preference",
    description: "How this team likes to work (tools, workflow, style).",
    badgeClass:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900",
  },
  SecurityNote: {
    label: "Security Note",
    description: "Threats, hardening steps, and sensitive-handling rules.",
    badgeClass:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900",
  },
  General: {
    label: "General",
    description: "Anything that doesn't fit a more specific category.",
    badgeClass:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
};

/** Convenience: the display label for a category. */
export function categoryLabel(category: MemoryCategory): string {
  return CATEGORY_META[category]?.label ?? category;
}

// ---------------------------------------------------------------------------
// Importance scale (1–5)
// ---------------------------------------------------------------------------

/** The allowed importance values, low → critical. */
export const IMPORTANCE_LEVELS = [1, 2, 3, 4, 5] as const;

/** Union `1 | 2 | 3 | 4 | 5`. */
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

/** Default importance for a new memory. Mirrors the Prisma default. */
export const DEFAULT_IMPORTANCE: Importance = 3;

/** Labels for each importance level, e.g. `3 → "Moderate"`, `5 → "Critical"`. */
export const IMPORTANCE_LABELS: Record<Importance, string> = {
  1: "Low",
  2: "Minor",
  3: "Moderate",
  4: "High",
  5: "Critical",
};

/** `"3 Moderate"`-style label used in selectors and the context markdown. */
export function importanceLabel(value: number): string {
  const level = IMPORTANCE_LABELS[value as Importance];
  return level ? `${value} ${level}` : String(value);
}

/** Zod schema for importance: an integer clamped to the 1–5 scale. */
export const importanceSchema = z
  .number()
  .int()
  .min(1)
  .max(5) as z.ZodType<Importance>;
