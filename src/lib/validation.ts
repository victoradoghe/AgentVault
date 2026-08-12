/**
 * Shared Zod schemas for memory input.
 *
 * Used by the create/edit forms (via @hookform/resolvers) AND by API route
 * handlers, so the client and server validate against the exact same rules.
 * Category and importance come from the single source of truth in
 * `./categories`.
 */
import { z } from "zod";

import {
  DEFAULT_CATEGORY,
  DEFAULT_IMPORTANCE,
  MEMORY_CATEGORIES,
  memoryCategorySchema,
  importanceSchema,
} from "@/lib/categories";

/**
 * The undefaulted field rules, shared by the create and update schemas below.
 * Kept separate so the update schema can reuse the *validation* without
 * inheriting the create schema's defaults — see `memoryUpdateSchema`.
 */
const titleSchema = z.string().trim().min(1, "Title is required").max(200);
const contentSchema = z.string().trim().min(1, "Content is required").max(20_000);

/** Fields a user edits when creating a memory. Missing fields get defaults. */
export const memoryInputSchema = z.object({
  title: titleSchema,
  content: contentSchema,
  category: memoryCategorySchema.default(DEFAULT_CATEGORY),
  importance: importanceSchema.default(DEFAULT_IMPORTANCE),
});

/** Input type before defaults are applied (what a form's fields hold). */
export type MemoryInput = z.input<typeof memoryInputSchema>;

/** Output type after parsing (what handlers receive). */
export type MemoryInputParsed = z.output<typeof memoryInputSchema>;

/**
 * Edit is the same shape but every field optional (partial update / PATCH).
 *
 * NOTE: this is deliberately NOT `memoryInputSchema.partial()`. Zod's
 * `.partial()` makes a field optional but leaves its `.default()` in place, so
 * an omitted `category`/`importance` would be *filled in* rather than left
 * alone — turning `PATCH { title }` into a silent reset of the memory's
 * category to "General" and importance to 3. A patch must only ever carry the
 * keys the caller actually sent.
 */
export const memoryUpdateSchema = z.object({
  title: titleSchema.optional(),
  content: contentSchema.optional(),
  category: memoryCategorySchema.optional(),
  importance: importanceSchema.optional(),
});
export type MemoryUpdate = z.input<typeof memoryUpdateSchema>;

/**
 * Filter value for the dashboard table's category dropdown: any category, or
 * the sentinel `"all"` meaning no filter.
 */
export const CATEGORY_FILTER_ALL = "all" as const;
export const categoryFilterSchema = z.enum([
  CATEGORY_FILTER_ALL,
  ...MEMORY_CATEGORIES,
]);
export type CategoryFilter = z.infer<typeof categoryFilterSchema>;
