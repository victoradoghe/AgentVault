"use client";

/**
 * /dashboard/mcp-setup
 *
 * Copy-paste setup instructions for the `amc-mcp` MCP server. The config
 * snippets here are kept byte-for-byte identical to packages/amc-mcp/README.md
 * — if you change one, change the other.
 *
 * NOTE: the surrounding dashboard shell (nav, auth guard, layout) is owned by
 * the dashboard phase. This page is intentionally self-contained so it can be
 * dropped into that shell without rework.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CLAUDE_CODE_CLI = `claude mcp add amc \\
  -e AMC_API_KEY=amc_your_key_here \\
  -- npx -y amc-mcp`;

const CLAUDE_CODE_JSON = `{
  "mcpServers": {
    "amc": {
      "command": "npx",
      "args": ["-y", "amc-mcp"],
      "env": {
        "AMC_API_KEY": "amc_your_key_here"
      }
    }
  }
}`;

const CODEX_TOML = `[mcp_servers.amc]
command = "npx"
args = ["-y", "amc-mcp"]
env = { AMC_API_KEY = "amc_your_key_here" }`;

const OPENCODE_JSON = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "amc": {
      "type": "local",
      "command": ["npx", "-y", "amc-mcp"],
      "environment": {
        "AMC_API_KEY": "amc_your_key_here"
      },
      "enabled": true
    }
  }
}`;

const LOCAL_DEV = `claude mcp add amc-dev \\
  -e AMC_API_KEY=amc_your_key_here \\
  -e AMC_BASE_URL=http://localhost:3000 \\
  -- npx -y amc-mcp`;

const TOOLS: Array<{ name: string; desc: string }> = [
  { name: "list_projects", desc: "List the memory projects available to your API key." },
  {
    name: "get_project_context(project_slug)",
    desc: "Load my memory — returns the full markdown context bundle. Call at the start of a task.",
  },
  { name: "search_memory(project_slug, query, limit?)", desc: "Semantic search over a project's memories." },
  {
    name: "save_memory(project_slug, title, content, category?, importance?)",
    desc: "Save an important decision/fact. Call when a meaningful decision is made.",
  },
  { name: "list_memories(project_slug, category?)", desc: "List a project's memories, optionally by category." },
  { name: "delete_memory(memory_id)", desc: "Permanently delete one memory." },
];

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      {label ? (
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      ) : null}
      <div className="relative rounded-md border bg-muted/50">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          aria-label="Copy to clipboard"
          className="absolute right-2 top-2 h-7 w-7 text-muted-foreground"
        >
          {copied ? <Check className="text-emerald-500" /> : <Copy />}
        </Button>
        <pre className="overflow-x-auto p-4 pr-12 text-sm">
          <code className="font-mono">{code}</code>
        </pre>
      </div>
    </div>
  );
}

export default function McpSetupPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Connect your agent</h1>
          <Badge variant="secondary">MCP</Badge>
        </div>
        <p className="text-muted-foreground">
          The <code className="rounded bg-muted px-1 py-0.5 text-sm">amc-mcp</code> server gives your
          coding agent persistent, project-scoped memory. Pick your agent below and paste the config.
        </p>
      </header>

      {/* Step 1 — API key */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">1. Get your API key</CardTitle>
          <CardDescription>
            Create a key under <strong>Settings → API Keys</strong>. It looks like{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">amc_…</code> and is sent as a
            Bearer token. Replace <code className="rounded bg-muted px-1 py-0.5 text-sm">amc_your_key_here</code>{" "}
            in the snippets below.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Step 2 — configure agent */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">2. Add the MCP server</CardTitle>
          <CardDescription>Choose your agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="claude" className="w-full">
            <TabsList>
              <TabsTrigger value="claude">Claude Code</TabsTrigger>
              <TabsTrigger value="codex">Codex CLI</TabsTrigger>
              <TabsTrigger value="opencode">OpenCode</TabsTrigger>
            </TabsList>

            <TabsContent value="claude" className="space-y-4">
              <CodeBlock label="Option A — CLI (recommended)" code={CLAUDE_CODE_CLI} />
              <CodeBlock
                label="Option B — project .mcp.json (commit to share with your team)"
                code={CLAUDE_CODE_JSON}
              />
              <p className="text-sm text-muted-foreground">
                Restart Claude Code, then run <code className="rounded bg-muted px-1 py-0.5">/mcp</code>{" "}
                to confirm <code className="rounded bg-muted px-1 py-0.5">amc</code> is connected.
              </p>
            </TabsContent>

            <TabsContent value="codex" className="space-y-4">
              <CodeBlock label="~/.codex/config.toml" code={CODEX_TOML} />
            </TabsContent>

            <TabsContent value="opencode" className="space-y-4">
              <CodeBlock
                label="opencode.json (project root) or ~/.config/opencode/opencode.json"
                code={OPENCODE_JSON}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Env vars */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Environment variables</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Variable</th>
                  <th className="py-2 pr-4 font-medium">Required</th>
                  <th className="py-2 font-medium">Default</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b">
                  <td className="py-2 pr-4">AMC_API_KEY</td>
                  <td className="py-2 pr-4">Yes</td>
                  <td className="py-2 text-muted-foreground">—</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">AMC_BASE_URL</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 text-muted-foreground">
                    https://agent-memory-cloud.vercel.app
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            For local development, set{" "}
            <code className="rounded bg-muted px-1 py-0.5">AMC_BASE_URL</code> to your dev server:
          </p>
          <div className="mt-3">
            <CodeBlock code={LOCAL_DEV} />
          </div>
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Available tools</CardTitle>
          <CardDescription>
            Your agent calls these automatically. Nudge it to load context at the start of a task and
            save memories when decisions are made.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {TOOLS.map((t) => (
              <li key={t.name} className="flex flex-col gap-0.5 border-b pb-3 last:border-0 last:pb-0">
                <code className="text-sm font-semibold">{t.name}</code>
                <span className="text-sm text-muted-foreground">{t.desc}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
