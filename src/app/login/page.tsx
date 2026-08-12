import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in · Agent Memory Cloud" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Agent Memory Cloud
      </Link>
      {/* useSearchParams (for the ?next= redirect) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
