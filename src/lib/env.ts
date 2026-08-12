import { z } from "zod";

/**
 * Environment variable schema for Agent Memory Cloud.
 *
 * Nothing here is allowed to throw at import time — this module is pulled in by
 * `prisma.ts` and therefore by every server module, including auth paths that
 * don't touch the database. Missing/invalid values degrade to `undefined` so
 * the app still BOOTS without a configured database (e.g. before Supabase is
 * connected): local auth and the dashboard shell work, and only the code that
 * actually queries the DB fails, with a clear error. `prisma.ts` supplies a
 * fallback connection string and warns when DATABASE_URL is unset.
 */
/** Treat empty/whitespace strings as unset before applying an optional schema. */
function emptyToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema,
  );
}

const envSchema = z.object({
  // Database — optional so a missing/invalid URL doesn't crash boot. DATABASE_URL
  // is the pooled (pgBouncer) runtime connection; DIRECT_URL is used for
  // migrations. `.catch(undefined)` turns a bad value into "unset".
  DATABASE_URL: emptyToUndefined(z.url().optional().catch(undefined)),
  DIRECT_URL: emptyToUndefined(z.url().optional().catch(undefined)),

  // Supabase — all optional: when unset (or blank/invalid), the app runs on the
  // local dev auth stopgap (see src/lib/auth-mode.ts). `.catch(undefined)` means
  // a leftover placeholder (e.g. an invalid URL in a half-filled .env) degrades
  // to "not configured" and keeps local mode working, instead of crashing boot.
  NEXT_PUBLIC_SUPABASE_URL: emptyToUndefined(z.url().optional().catch(undefined)),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: emptyToUndefined(
    z.string().min(1).optional().catch(undefined),
  ),
  SUPABASE_SERVICE_ROLE_KEY: emptyToUndefined(
    z.string().min(1).optional().catch(undefined),
  ),
});

// Reference NEXT_PUBLIC_* statically so Next.js inlines them for the browser.
const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(z.treeifyError(parsed.error), null, 2)
  );
  throw new Error("Invalid environment variables. See errors above.");
}

/** Typed, validated environment variables. */
export const env = parsed.data;

export type Env = typeof env;
