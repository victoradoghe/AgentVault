import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { NotFoundError } from "./errors";
import {
  createProjectSchema,
  projectIdSchema,
  projectSlugSchema,
  userIdSchema,
  type CreateProjectInput,
} from "./schemas";

/**
 * Project service.
 *
 * Every function takes the acting `userId` and scopes its query to it, so a
 * user can only ever see or mutate their own projects. Slugs are generated from
 * the project name and made unique per user (there's a `@@unique([userId, slug])`
 * constraint backing this up).
 */

/** A project as returned to callers, including its memory count. */
export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  memoryCount: number;
  createdAt: Date;
}

function toSummary(p: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  _count: { memories: number };
}): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    memoryCount: p._count.memories,
    createdAt: p.createdAt,
  };
}

/**
 * Turn an arbitrary name into a url-safe slug: lowercase, ASCII-folded, with
 * runs of non-alphanumerics collapsed to single hyphens.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, ""); // tidy a trailing hyphen left by the slice
  return slug || "project";
}

/**
 * Create a project for a user. The slug is derived from `name`; if that slug is
 * already taken by the same user we append `-2`, `-3`, … until it's free,
 * retrying on the DB uniqueness constraint to stay correct under races.
 */
export async function createProject(
  input: CreateProjectInput
): Promise<ProjectSummary> {
  const { userId, name } = createProjectSchema.parse(input);
  const base = slugify(name);

  for (let attempt = 0; attempt < 25; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const project = await prisma.project.create({
        data: { userId, name, slug },
        include: { _count: { select: { memories: true } } },
      });
      return toSummary(project);
    } catch (err) {
      // P2002 = unique constraint violation (userId+slug already taken).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  // Extremely unlikely: 25 distinct slugs all taken in the same instant.
  throw new Error(`Could not generate a unique slug for "${name}".`);
}

/** List a user's projects, newest first, each with its memory count. */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const uid = userIdSchema.parse(userId);
  const projects = await prisma.project.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { memories: true } } },
  });
  return projects.map(toSummary);
}

/** Look up one of the user's projects by slug. Throws if not found/owned. */
export async function getProjectBySlug(
  userId: string,
  slug: string
): Promise<ProjectSummary> {
  const uid = userIdSchema.parse(userId);
  const s = projectSlugSchema.parse(slug);
  const project = await prisma.project.findFirst({
    where: { userId: uid, slug: s },
    include: { _count: { select: { memories: true } } },
  });
  if (!project) throw new NotFoundError("Project");
  return toSummary(project);
}

/**
 * Delete one of the user's projects (and, via `onDelete: Cascade`, all of its
 * memories). Throws `NotFoundError` if the project doesn't exist or isn't owned
 * by the user.
 */
export async function deleteProject(
  userId: string,
  projectId: string
): Promise<void> {
  const uid = userIdSchema.parse(userId);
  const pid = projectIdSchema.parse(projectId);
  const { count } = await prisma.project.deleteMany({
    where: { id: pid, userId: uid },
  });
  if (count === 0) throw new NotFoundError("Project");
}

/**
 * Internal helper: assert the project exists and is owned by the user, and
 * return its id. Used by the memory and search services before doing work
 * scoped to a project. Throws `NotFoundError` otherwise.
 */
export async function requireOwnedProject(
  userId: string,
  projectId: string
): Promise<string> {
  const uid = userIdSchema.parse(userId);
  const pid = projectIdSchema.parse(projectId);
  const project = await prisma.project.findFirst({
    where: { id: pid, userId: uid },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Project");
  return project.id;
}
