"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  AUTH_UNCONFIGURED_MESSAGE,
  isAuthUnconfigured,
  isSupabaseConfigured,
  LOCAL_USER_STORAGE_KEY,
} from "@/lib/auth-mode";
import { resolveNextPath } from "@/lib/redirects";

interface Credentials {
  email: string;
  password?: string;
}

export interface AuthFormProps {
  mode: "login" | "register";
}

/**
 * Email/password auth form. Uses Supabase Auth when configured; otherwise falls
 * back to the local dev stopgap (email only, no password) so the app is usable
 * before a Supabase project exists. Adding the Supabase env vars flips this
 * automatically — no code change.
 */
export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  const supabaseMode = isSupabaseConfigured();
  const unconfigured = isAuthUnconfigured();

  // One stable shape (password always optional); the 8-char rule only applies in
  // Supabase mode. Keeping the shape constant keeps the resolver types clean.
  const schema = z
    .object({
      email: z.email("Enter a valid email address."),
      password: z.string().optional(),
    })
    .superRefine((val, ctx) => {
      if (supabaseMode && (val.password?.length ?? 0) < 8) {
        ctx.addIssue({
          code: "custom",
          path: ["password"],
          message: "Password must be at least 8 characters.",
        });
      }
    });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Credentials>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const isLogin = mode === "login";
  const next = resolveNextPath(searchParams.get("next"));

  const onSubmit = async ({ email, password }: Credentials) => {
    setSubmitting(true);
    try {
      // --- Local dev mode: no Supabase, no password. ---
      if (!supabaseMode) {
        // The server would reject this anyway (the route 404s outside local
        // mode); refusing here keeps the error honest instead of cryptic.
        if (unconfigured) throw new Error(AUTH_UNCONFIGURED_MESSAGE);

        const res = await fetch("/api/auth/local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "Sign-in failed.");
        }
        try {
          localStorage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify({ email }));
        } catch {
          // localStorage unavailable (private mode) — the cookie still works.
        }
        toast.success("Signed in (local mode).");
        router.push(next);
        router.refresh();
        return;
      }

      // --- Supabase mode. ---
      const supabase = createClient();

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: password ?? "",
        });
        if (error) throw error;
        toast.success("Signed in.");
        router.push(next);
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: password ?? "",
      });
      if (error) throw error;

      if (data.session) {
        toast.success("Account created.");
        router.push(next);
        router.refresh();
      } else {
        toast.success("Check your email to confirm your account, then sign in.");
        router.push("/login");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // No auth backend at all. Show the operator what to set rather than a form
  // that cannot possibly succeed.
  if (unconfigured) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sign-in unavailable</CardTitle>
          <CardDescription>This deployment has no authentication configured.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {AUTH_UNCONFIGURED_MESSAGE}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">
          {isLogin ? "Sign in" : "Create your account"}
        </CardTitle>
        <CardDescription>
          {isLogin
            ? "Access your projects, memories, and API keys."
            : "Start giving your coding agents persistent memory."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {!supabaseMode && (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Local dev mode — Supabase isn&apos;t configured. Sign in with any email
              (no password). Your session is kept in this browser.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
          {supabaseMode && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                placeholder="••••••••"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {isLogin ? "No account yet? " : "Already have an account? "}
            <Link
              href={isLogin ? "/register" : "/login"}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {isLogin ? "Create one" : "Sign in"}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
