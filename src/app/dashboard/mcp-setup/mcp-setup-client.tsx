"use client";

/**
 * Connect-your-agent UI.
 *
 * The goal is zero manual editing: you paste your API key once and every
 * snippet below becomes copy-and-run. Two things used to be filled in by hand
 * and got them wrong often enough to be worth automating:
 *
 *   - the API key (the old page shipped a literal `amc_your_key_here`), and
 *   - the base URL, which must match the port this app is actually served on.
 *     The old page hardcoded a deployment that doesn't exist, so every tool call
 *     failed against a dead host; `window.location.origin` is always right.
 *
 * The launch command runs the locally built entrypoint directly, because
 * `amc-mcp` is not published to npm — `npx -y amc-mcp` fails with a 404.
 */

import { useEffect, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const KEY_PLACEHOLDER = "amc_paste_your_key_here";

const TOOLS: Array<{ name: string; desc: string }> = [
  { name: "list_projects", desc: "Find a project_slug." },
  {
    name: "get_project_context(project_slug)",
    desc: "Load a project's curated memory. Agents call this at the start of a task.",
  },
  {
    name: "search_memory(project_slug, query, limit?)",
    desc: "Targeted semantic recall mid-task. Long bodies are truncated.",
  },
  {
    name: "save_memory(project_slug, title, content, category?, importance?)",
    desc: "Persist a decision. Agents call this when something durable is decided.",
  },
  {
    name: "list_memories(project_slug, category?)",
    desc: "Browse titles only — bodies are omitted to save tokens.",
  },
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

export function McpSetup({
  entrypoint,
  isBuilt,
}: {
  entrypoint: string;
  isBuilt: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // Read the origin on the client so the port always matches reality.
  useEffect(() => setBaseUrl(window.location.origin), []);

  const key = apiKey.trim() || KEY_PLACEHOLDER;
  const url = baseUrl || "http://localhost:3000";
  const ready = apiKey.trim().length > 0;

  const claudeCli = `claude mcp add agentvault \\
  -e AMC_API_KEY=${key} \\
  -e AMC_BASE_URL=${url} \\
  -- node ${entrypoint}`;

  const codexCli = `codex mcp add agentvault \\
  --env AMC_API_KEY=${key} \\
  --env AMC_BASE_URL=${url} \\
  -- node ${entrypoint}`;

  const codexToml = `[mcp_servers.agentvault]
command = "node"
args = ["${entrypoint}"]
env = { AMC_API_KEY = "${key}", AMC_BASE_URL = "${url}" }`;

  const claudeJson = `{
  "mcpServers": {
    "agentvault": {
      "command": "node",
      "args": ["${entrypoint}"],
      "env": {
        "AMC_API_KEY": "${key}",
        "AMC_BASE_URL": "${url}"
      }
    }
  }
}`;

  const opencodeJson = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agentvault": {
      "type": "local",
      "command": ["node", "${entrypoint}"],
      "environment": {
        "AMC_API_KEY": "${key}",
        "AMC_BASE_URL": "${url}"
      },
      "enabled": true
    }
  }
}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Connect your agent</h1>
          <Badge variant="secondary">MCP</Badge>
        </div>
        <p className="text-muted-foreground">
          Paste your API key below and every command on this page becomes ready to run —
          no editing, no placeholders.
        </p>
      </header>

      {!isBuilt ? (
        <Card className="mb-6 border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TriangleAlert className="h-5 w-5 text-amber-500" />
              Build the MCP server first
            </CardTitle>
            <CardDescription>
              The entrypoint below doesn&apos;t exist yet. Run this once in the AgentVault
              repo, then reload this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code="pnpm --filter amc-mcp build" />
          </CardContent>
        </Card>
      ) : null}

      {/* Step 1 — key */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">1. Paste your API key</CardTitle>
          <CardDescription>
            Create one under <strong>Settings → API Keys</strong>. It&apos;s shown once, so
            paste it here straight away. It stays in your browser — it is never sent
            anywhere by this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="api-key" className="sr-only">
            API key
          </Label>
          <Input
            id="api-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={KEY_PLACEHOLDER}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {ready ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                ✓ Commands below are ready to copy and run.
              </span>
            ) : (
              "Commands below still contain a placeholder until you paste a key."
            )}
          </p>
        </CardContent>
      </Card>

      {/* Step 2 — add server */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">2. Add the MCP server</CardTitle>
          <CardDescription>
            Pick your agent, copy one command, run it. Pointing at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">{url}</code> — the
            address you&apos;re viewing this page on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="claude" className="w-full">
            <TabsList>
              <TabsTrigger value="claude">Claude Code</TabsTrigger>
              <TabsTrigger value="codex">Codex CLI</TabsTrigger>
              <TabsTrigger value="opencode">OpenCode</TabsTrigger>
            </TabsList>

            <TabsContent value="claude" className="space-y-4">
              <CodeBlock label="Run this (recommended)" code={claudeCli} />
              <CodeBlock label="Or edit .mcp.json by hand" code={claudeJson} />
              <p className="text-sm text-muted-foreground">
                Restart Claude Code, then run{" "}
                <code className="rounded bg-muted px-1 py-0.5">/mcp</code> to confirm{" "}
                <code className="rounded bg-muted px-1 py-0.5">agentvault</code> is connected.
              </p>
            </TabsContent>

            <TabsContent value="codex" className="space-y-4">
              <CodeBlock label="Run this (recommended)" code={codexCli} />
              <CodeBlock label="Or edit ~/.codex/config.toml by hand" code={codexToml} />
              <p className="text-sm text-muted-foreground">
                Verify with{" "}
                <code className="rounded bg-muted px-1 py-0.5">codex mcp get agentvault</code>.
              </p>
            </TabsContent>

            <TabsContent value="opencode" className="space-y-4">
              <CodeBlock
                label="opencode.json (project root) or ~/.config/opencode/opencode.json"
                code={opencodeJson}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Gotchas */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Two things that will bite you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">AgentVault must be running.</strong> The MCP
            server is a thin HTTP client with no local storage — if this app isn&apos;t up,
            every memory tool fails.
          </p>
          <p>
            <strong className="text-foreground">Keep the port stable.</strong> The commands
            above hardcode{" "}
            <code className="rounded bg-muted px-1 py-0.5">{url}</code>. If Next starts on a
            different port because this one was taken, the tools break — start it with an
            explicit <code className="rounded bg-muted px-1 py-0.5">-p</code> flag.
          </p>
          <p>
            <strong className="text-foreground">
              Don&apos;t use <code className="rounded bg-muted px-1 py-0.5">npx -y amc-mcp</code>.
            </strong>{" "}
            The package isn&apos;t published to npm, so that fails. The commands above launch
            your local build instead. Rebuild after changing its source with{" "}
            <code className="rounded bg-muted px-1 py-0.5">pnpm --filter amc-mcp build</code>.
          </p>
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Available tools</CardTitle>
          <CardDescription>
            Your agent calls these automatically once connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {TOOLS.map((t) => (
              <li
                key={t.name}
                className="flex flex-col gap-0.5 border-b pb-3 last:border-0 last:pb-0"
              >
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
