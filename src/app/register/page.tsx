import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { resolveNextPath } from "@/lib/redirects";
import { getSessionEmail } from "@/server/auth";

export const metadata = { title: "Create account · AgentVault" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // A signed-in user has no business on the sign-up form; see login/page.tsx.
  if (await getSessionEmail()) redirect(resolveNextPath(next));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        AgentVault
      </Link>
      <Suspense fallback={null}>
        <AuthForm mode="register" />
      </Suspense>
    </main>
  );
}
