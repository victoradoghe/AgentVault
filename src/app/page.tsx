import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/redirects";
import { getSessionEmail } from "@/server/auth";

export default async function Home() {
  // Session-only check — no database round trip, so the landing page still
  // renders if the database is down.
  const email = await getSessionEmail();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        AgentVault
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Persistent, shareable, semantically-searchable memory for your AI coding
        agents. Connect any MCP-capable CLI — Claude Code, Codex, OpenCode — and your
        agent carries context between sessions instead of starting cold.
      </p>
      {email ? (
        // Already signed in — skip the sign-in dance entirely.
        <div className="flex flex-col items-center gap-3">
          <Button asChild size="lg">
            <Link href={DEFAULT_SIGNED_IN_PATH}>Open dashboard</Link>
          </Button>
          <p className="text-sm text-muted-foreground">Signed in as {email}</p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button asChild size="lg">
            <Link href="/register">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
