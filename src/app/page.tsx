import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
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
      <div className="flex items-center gap-3">
        <Button asChild size="lg">
          <Link href="/register">Get started</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
