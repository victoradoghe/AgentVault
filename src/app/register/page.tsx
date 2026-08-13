import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create account · AgentVault" };

export default function RegisterPage() {
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
