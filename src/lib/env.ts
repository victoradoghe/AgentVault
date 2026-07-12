import { z } from "zod";

/**
 * Environment variable schema for Agent Memory Cloud.
 *
 * Phase 1: every variable is optional so the app still boots without a
 * configured backend. As the service layer lands we can tighten these
 * (e.g. make DATABASE_URL required) without changing call sites.
 */
const envSchema = z.object({
  // Database (Postgres / Supabase)
  DATABASE_URL: z.url().optional(),
  DIRECT_URL: z.url().optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
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
