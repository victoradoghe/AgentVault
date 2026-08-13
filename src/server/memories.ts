import type { MemoryCategory } from "@/lib/categories";
import { prisma } from "@/lib/prisma";

import { embed, toPgVector } from "./embeddings";
import { NotFoundError } from "./errors";
import { requireOwnedProject } from "./projects";
import {
  createMemorySchema,
  listMemoriesSchema,
  memoryIdSchema,
  updateMemorySchema,
  userIdSchema,
  type CreateMemoryInput,
  type ListMemoriesInput,
  type UpdateMemoryInput,
} from "./schemas";

/**
 * Core memory service — the heart of AgentVault.
 *
 * ALL memory business logic lives here. The REST API and the MCP server call
 * these functions; neither ever touches Prisma or the embedding model directly.
 *
 * Every function is scoped to the acting `userId`. A memory belongs to a
 * project, which belongs to a user, so ownership is enforced by filtering on
 * the `project.userId` relation — cross-user access simply finds nothing and
 * raises `NotFoundError`.
 *
 * The embedding lives in a pgvector `embedding vector(384)` column that Prisma
 * can't model, so it's written with a raw `UPDATE ... ::vector` immediately
 * after the row is inserted, inside the same transaction for atomicity.
 */

/** A memory row as returned to callers. */
export interface MemoryRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Columns selected for the returned record — never the raw embedding. */
const memorySelect = {
  id: true,
  projectId: true,
  title: true,
  content: true,
  category: true,
  importance: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toRecord(m: {
  id: string;
  projectId: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): MemoryRecord {
  return { ...m, category: m.category as MemoryCategory };
}

/** The text we embed for a memory: its title and content together. */
function embeddingText(title: string, content: string): string {
  return `${title}\n\n${content}`;
}

/**
 * Create a memory: embed `${title}\n\n${content}`, insert the row, then write
 * the vector via raw SQL — all in one transaction so a memory never exists
 * without its embedding.
 */
export async function createMemory(
  input: CreateMemoryInput
): Promise<MemoryRecord> {
  const data = createMemorySchema.parse(input);
  await requireOwnedProject(data.userId, data.projectId);

  // Embed BEFORE opening the transaction so model inference doesn't hold a DB
  // connection open.
  const vector = toPgVector(await embed(embeddingText(data.title, data.content)));

  const created = await prisma.$transaction(async (tx) => {
    const memory = await tx.memory.create({
      data: {
        projectId: data.projectId,
        title: data.title,
        content: data.content,
        category: data.category,
        importance: data.importance,
      },
      select: memorySelect,
    });
    await tx.$executeRaw`
      UPDATE memories SET embedding = ${vector}::vector WHERE id = ${memory.id}::uuid
    `;
    return memory;
  });

  return toRecord(created);
}

/**
 * Update a memory. Re-embeds only when the title or content actually changed.
 * Throws `NotFoundError` if the memory isn't owned by the user.
 */
export async function updateMemory(
  input: UpdateMemoryInput
): Promise<MemoryRecord> {
  const data = updateMemorySchema.parse(input);

  const existing = await prisma.memory.findFirst({
    where: { id: data.memoryId, project: { userId: data.userId } },
    select: { id: true, title: true, content: true },
  });
  if (!existing) throw new NotFoundError("Memory");

  const nextTitle = data.title ?? existing.title;
  const nextContent = data.content ?? existing.content;
  const contentChanged =
    (data.title !== undefined && data.title !== existing.title) ||
    (data.content !== undefined && data.content !== existing.content);

  // Re-embed outside the transaction when needed.
  const vector = contentChanged
    ? toPgVector(await embed(embeddingText(nextTitle, nextContent)))
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const memory = await tx.memory.update({
      where: { id: data.memoryId },
      data: {
        title: data.title,
        content: data.content,
        category: data.category,
        importance: data.importance,
      },
      select: memorySelect,
    });
    if (vector !== null) {
      await tx.$executeRaw`
        UPDATE memories SET embedding = ${vector}::vector WHERE id = ${memory.id}::uuid
      `;
    }
    return memory;
  });

  return toRecord(updated);
}

/**
 * Delete a memory the user owns. Throws `NotFoundError` if it doesn't exist or
 * belongs to someone else.
 */
export async function deleteMemory(
  userId: string,
  memoryId: string
): Promise<void> {
  const uid = userIdSchema.parse(userId);
  const mid = memoryIdSchema.parse(memoryId);
  const { count } = await prisma.memory.deleteMany({
    where: { id: mid, project: { userId: uid } },
  });
  if (count === 0) throw new NotFoundError("Memory");
}

/**
 * List a project's memories (optionally filtered by category), most important
 * and most recent first. Verifies the project is owned by the user.
 */
export async function listMemories(
  input: ListMemoriesInput
): Promise<MemoryRecord[]> {
  const { userId, projectId, category } = listMemoriesSchema.parse(input);
  await requireOwnedProject(userId, projectId);

  const memories = await prisma.memory.findMany({
    where: { projectId, category },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    select: memorySelect,
  });
  return memories.map(toRecord);
}

/** Fetch a single memory the user owns. Throws `NotFoundError` otherwise. */
export async function getMemory(
  userId: string,
  memoryId: string
): Promise<MemoryRecord> {
  const uid = userIdSchema.parse(userId);
  const mid = memoryIdSchema.parse(memoryId);
  const memory = await prisma.memory.findFirst({
    where: { id: mid, project: { userId: uid } },
    select: memorySelect,
  });
  if (!memory) throw new NotFoundError("Memory");
  return toRecord(memory);
}
