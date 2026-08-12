import { type MemoryCategory } from "@/lib/categories";
import { prisma } from "@/lib/prisma";

import { buildProjectContext, type ProjectContext } from "./context";
import { embed, toPgVector } from "./embeddings";
import { requireOwnedProject } from "./projects";
import {
  projectContextSchema,
  searchMemoriesSchema,
  type ProjectContextInput,
  type SearchMemoriesInput,
} from "./schemas";

export type { ProjectContext } from "./context";

/**
 * Semantic search and context assembly.
 *
 * Both are read paths scoped to a single owned project. Search embeds the query
 * and ranks memories by pgvector cosine distance (`<=>`); context assembles a
 * compact, importance-ranked bundle of the project's defining memories for
 * injection at the start of an agent session.
 *
 * The context selection/formatting logic is the pure `buildProjectContext`
 * builder in `./context`; this module owns only the ownership check and the
 * database read, keeping business logic in one place.
 */

/** A search hit: the memory plus its similarity score (1 = identical). */
export interface SearchResult {
  id: string;
  title: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
}

/** Shape of a raw search row before light post-processing. */
interface SearchRow {
  id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  similarity: number;
}

/**
 * Semantic search within one of the user's projects.
 *
 * Embeds the query, then runs a pgvector nearest-neighbour query using cosine
 * distance (`<=>`). Ownership is enforced twice: `requireOwnedProject` first,
 * and again in the SQL via the join to `projects.user_id` — so a mismatched
 * user id can never return another user's rows.
 */
export async function searchMemories(
  input: SearchMemoriesInput
): Promise<SearchResult[]> {
  const { userId, projectId, query, limit } = searchMemoriesSchema.parse(input);
  await requireOwnedProject(userId, projectId);

  const vector = toPgVector(await embed(query));

  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT
      m.id,
      m.title,
      m.content,
      m.category,
      m.importance,
      m.status,
      m.created_at AS "createdAt",
      m.updated_at AS "updatedAt",
      1 - (m.embedding <=> ${vector}::vector) AS similarity
    FROM memories m
    JOIN projects p ON p.id = m.project_id
    WHERE p.user_id = ${userId}::uuid
      AND m.project_id = ${projectId}::uuid
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> ${vector}::vector
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category as MemoryCategory,
    importance: r.importance,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // pgvector returns a double; guard against string coercion just in case.
    score: Number(r.similarity),
  }));
}

/**
 * Assemble a project's context bundle: the compact, importance-ranked package
 * of its defining memories, ready to inject at the start of an agent session.
 *
 * Ownership is enforced here, then the project's memories are handed to the pure
 * `buildProjectContext` builder (in `./context`), which does the selection,
 * token-budgeting, and markdown rendering. The result is clean structured data
 * (with a ready-to-inject `markdown` field).
 */
export async function getProjectContext(
  input: ProjectContextInput
): Promise<ProjectContext> {
  const { userId, projectId } = projectContextSchema.parse(input);
  await requireOwnedProject(userId, projectId);

  const memories = await prisma.memory.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      importance: true,
      updatedAt: true,
      status: true,
    },
  });

  return buildProjectContext(
    memories.map((m) => ({ ...m, category: m.category as MemoryCategory })),
    { projectId }
  );
}
