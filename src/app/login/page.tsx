import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { resolveNextPath } from "@/lib/redirects";
import { getSessionEmail } from "@/server/auth";

export const metadata = { title: "Sign in · AgentVault" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Already signed in? Don't make them authenticate again — send them straight
  // on. `getSessionEmail` only reads the session (no database round trip), so
  // this still works when the database is unreachable.
  if (await getSessionEmail()) redirect(resolveNextPath(next));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        AgentVault
      </Link>
      {/* useSearchParams (for the ?next= redirect) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
