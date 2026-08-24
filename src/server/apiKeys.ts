import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { NotFoundError } from "./errors";
import { userIdSchema } from "./schemas";

/**
 * API-key service.
 *
 * Keys authenticate the REST API for CLI agents (the `amc-mcp` server sends the
 * key as a Bearer token). A key looks like `amc_<43 base64url chars>`. We store
 * only its SHA-256 hash — the raw key is shown to the user exactly once, at
 * creation, and is unrecoverable afterward. "Revoking" a key is a hard delete
 * (the schema has no `revokedAt`).
 */

/** Human-facing prefix so keys are recognisable and greppable. */
const KEY_PREFIX = "amc_";

/** A newly minted key: the raw secret (shown once) plus its stored metadata. */
export interface CreatedApiKey {
  id: string;
  /** The full secret, e.g. `amc_...`. Returned ONCE; never stored in the clear. */
  key: string;
  label: string | null;
  createdAt: Date;
}

/** An API key as listed in the dashboard — never includes the secret. */
export interface ApiKeySummary {
  id: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** A non-secret hint so a user can tell keys apart, e.g. `amc_…a1b2`. */
  maskedKey: string;
}

/** Generate a fresh random key string. */
function generateKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest of a raw key — what we persist and look up on. */
function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * A short, non-secret masked form derived from the hash (so it's stable for a
 * key without ever exposing key bytes we don't store).
 */
function maskFromHash(keyHash: string): string {
  return `${KEY_PREFIX}…${keyHash.slice(0, 4)}`;
}

/** Create a new API key for a user. The raw secret is returned only here. */
export async function createApiKey(
  userId: string,
  label?: string,
): Promise<CreatedApiKey> {
  const uid = userIdSchema.parse(userId);
  const trimmed = label?.trim();
  const rawKey = generateKey();

  const record = await prisma.apiKey.create({
    data: {
      userId: uid,
      keyHash: hashKey(rawKey),
      label: trimmed && trimmed.length > 0 ? trimmed.slice(0, 100) : null,
    },
    select: { id: true, label: true, createdAt: true },
  });

  return { id: record.id, key: rawKey, label: record.label, createdAt: record.createdAt };
}

/** List a user's API keys (metadata only), newest first. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const uid = userIdSchema.parse(userId);
  const keys = await prisma.apiKey.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, keyHash: true },
  });
  return keys.map((k) => ({
    id: k.id,
    label: k.label,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    maskedKey: maskFromHash(k.keyHash),
  }));
}

/**
 * Revoke (hard-delete) one of the user's keys. Throws `NotFoundError` if it
 * doesn't exist or isn't owned by the user.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const uid = userIdSchema.parse(userId);
  const { count } = await prisma.apiKey.deleteMany({
    where: { id: keyId, userId: uid },
  });
  if (count === 0) throw new NotFoundError("API key");
}

/**
 * Resolve a raw Bearer key to the owning user's id, or null if no key matches.
 * On a hit, `lastUsedAt` is bumped (best-effort, non-blocking on failure).
 *
 * Lookup is a unique-index hit on the hash — this runs on every authenticated
 * request, including every MCP tool call, so it must not scan the table. The
 * constant-time compare below is belt-and-suspenders against a theoretical hash
 * collision and keeps the comparison timing independent of the stored value.
 */
export async function getUserIdFromApiKey(rawKey: string): Promise<string | null> {
  const key = rawKey.trim();
  if (!key.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashKey(key);
  const match = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: { id: true, userId: true, keyHash: true },
  });
  if (!match) return null;

  // Constant-time confirmation of the (already-equal) hashes.
  const a = Buffer.from(match.keyHash);
  const b = Buffer.from(keyHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Best-effort usage timestamp; never block auth on it.
  void prisma.apiKey
    .update({ where: { id: match.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return match.userId;
}
