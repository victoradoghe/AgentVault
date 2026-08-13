"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOCAL_USER_STORAGE_KEY } from "@/lib/auth-mode";
import { signOut } from "@/app/dashboard/actions";

const LINKS = [
  { href: "/dashboard", label: "Projects", exact: true },
  { href: "/dashboard/settings/api-keys", label: "API Keys" },
  { href: "/dashboard/mcp-setup", label: "MCP Setup" },
];

export function DashboardNav({ email }: { email: string | null }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          AgentVault
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                isActive(link.href, link.exact) && "bg-muted text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {email && (
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
          )}
          <form
            action={signOut}
            onSubmit={() => {
              // Clear the local-mode identity mirror; harmless in Supabase mode.
              try {
                localStorage.removeItem(LOCAL_USER_STORAGE_KEY);
              } catch {
                // ignore
              }
            }}
          >
            <Button type="submit" variant="ghost" size="sm">
              <LogOut className="mr-1 h-4 w-4" />
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
