/**
 * Zod input schemas for the core service layer.
 *
 * Every exported service function validates its arguments against one of these
 * before touching the database, so both the REST API and the MCP server get the
 * same guarantees no matter how they call in. The category and importance rules
 * are imported from the single source of truth in `@/lib/categories` so the
 * taxonomy can never drift between the form, the API, and the DB.
 */
import { z } from "zod";

import {
  DEFAULT_CATEGORY,
  DEFAULT_IMPORTANCE,
  importanceSchema,
  memoryCategorySchema,
} from "@/lib/categories";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A user id. All service calls carry one for ownership scoping. */
export const userIdSchema = z.uuid();

/** A project id (UUID). */
export const projectIdSchema = z.uuid();

/** A memory id (UUID). */
export const memoryIdSchema = z.uuid();

const titleSchema = z.string().trim().min(1, "Title is required").max(200);
const contentSchema = z.string().trim().min(1, "Content is required").max(20_000);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  userId: userIdSchema,
  name: z.string().trim().min(1, "Project name is required").max(100),
});
// `z.input` so callers can omit fields that have a schema default.
export type CreateProjectInput = z.input<typeof createProjectSchema>;

/** A url-safe project slug. */
export const projectSlugSchema = z.string().trim().min(1).max(120);

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export const createMemorySchema = z.object({
  userId: userIdSchema,
  projectId: projectIdSchema,
  title: titleSchema,
  content: contentSchema,
  category: memoryCategorySchema.default(DEFAULT_CATEGORY),
  importance: importanceSchema.default(DEFAULT_IMPORTANCE),
});
export type CreateMemoryInput = z.input<typeof createMemorySchema>;

export const updateMemorySchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    category: memoryCategorySchema.optional(),
    importance: importanceSchema.optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.content !== undefined ||
      v.category !== undefined ||
      v.importance !== undefined,
    { message: "Provide at least one field to update" }
  );
export type UpdateMemoryInput = z.input<typeof updateMemorySchema>;

export const listMemoriesSchema = z.object({
  userId: userIdSchema,
  projectId: projectIdSchema,
  category: memoryCategorySchema.optional(),
});
export type ListMemoriesInput = z.input<typeof listMemoriesSchema>;

// ---------------------------------------------------------------------------
// Search & context
// ---------------------------------------------------------------------------

export const searchMemoriesSchema = z.object({
  userId: userIdSchema,
  projectId: projectIdSchema,
  query: z.string().trim().min(1, "Search query is required").max(1_000),
  limit: z.number().int().min(1).max(50).default(10),
});
export type SearchMemoriesInput = z.input<typeof searchMemoriesSchema>;

export const projectContextSchema = z.object({
  userId: userIdSchema,
  projectId: projectIdSchema,
});
export type ProjectContextInput = z.input<typeof projectContextSchema>;
