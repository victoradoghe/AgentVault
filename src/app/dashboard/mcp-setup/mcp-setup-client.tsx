"use client";

/**
 * Connect-your-agent UI.
 *
 * The goal is zero manual editing: pick where your memory lives, paste your API
 * key once, and every snippet below is copy-and-run. Three things used to be
 * filled in by hand and got them wrong often enough to be worth automating:
 *
 *   - the API key (an earlier page shipped a literal `amc_your_key_here`),
 *   - the base URL, which must match the port this app is actually served on —
 *     `window.location.origin` is always right, and
 *   - the launch command itself. It has to be one that runs: `amc-mcp` is not
 *     published, so `npx -y amc-mcp` is a 404 and `pnpm dlx -y` is not even a
 *     valid flag. Until a `MCP_PACKAGE_NAME` is configured, the commands launch
 *     the built entrypoint by absolute path.
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

type ConnectionMode = "hosted" | "local" | "custom";

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
  packageName,
  entrypoint,
  isBuilt,
}: {
  /** Registry name to run with npx, or null when launching from this checkout. */
  packageName: string | null;
  /** Absolute path to the built stdio server on the machine hosting this app. */
  entrypoint: string;
  /** Whether that file exists yet. */
  isBuilt: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<ConnectionMode>("hosted");
  const [hostedUrl, setHostedUrl] = useState("");
  const [customUrl, setCustomUrl] = useState("");

  // Read on the client only: the server has no idea which host/port the browser
  // used to reach it, and guessing produces config that fails on the first call.
  useEffect(() => setHostedUrl(window.location.origin), []);

  const key = apiKey.trim() || KEY_PLACEHOLDER;
  const url =
    (mode === "local"
      ? "http://127.0.0.1:3000"
      : mode === "custom"
        ? customUrl
        : hostedUrl
    )
      .trim()
      .replace(/\/+$/, "") || "http://127.0.0.1:3000";

  // One command shape, rendered into each agent's config format below.
  const command = packageName ? "npx" : "node";
  const args = packageName ? ["-y", `${packageName}@latest`] : [entrypoint];
  const launch = [command, ...args].join(" ");
  const jsonArgs = args.map((a) => JSON.stringify(a)).join(", ");

  const claudeCli = `claude mcp add agentvault -e AMC_API_KEY=${key} -e AMC_BASE_URL=${url} -- ${launch}`;
  const claudeJson = `{
  "mcpServers": {
    "agentvault": {
      "command": "${command}",
      "args": [${jsonArgs}],
      "env": { "AMC_API_KEY": "${key}", "AMC_BASE_URL": "${url}" }
    }
  }
}`;
  const codexToml = `[mcp_servers.agentvault]
command = "${command}"
args = [${jsonArgs}]
env = { AMC_API_KEY = "${key}", AMC_BASE_URL = "${url}" }`;
  const opencodeJson = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agentvault": {
      "type": "local",
      "command": ["${command}", ${jsonArgs}],
      "environment": { "AMC_API_KEY": "${key}", "AMC_BASE_URL": "${url}" },
      "enabled": true
    }
  }
}`;
  const setupPrompt = `Configure AgentVault MCP for me. Add a local MCP server named agentvault that runs: ${launch}. Set AMC_API_KEY to ${key} and AMC_BASE_URL to ${url}. Verify the server connects, then use list_projects and get_project_context at the start of future tasks.`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Connect your agent</h1>
          <Badge variant="secondary">MCP</Badge>
        </div>
        <p className="text-muted-foreground">
          Connect to hosted, local, or self-hosted AgentVault. The MCP process stays on
          your computer, so cached memory remains available offline.
        </p>
      </header>

      {!packageName && !isBuilt ? (
        <Card className="mb-6 border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TriangleAlert className="h-5 w-5 text-amber-500" />
              Build the MCP server first
            </CardTitle>
            <CardDescription>
              The commands below launch a file that does not exist yet, so your agent
              will fail to start until you build it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock label="Run once, in the AgentVault checkout" code="pnpm --filter amc-mcp build" />
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">1. Choose where your memory lives</CardTitle>
          <CardDescription>
            Use Hosted for this dashboard, Local for an AgentVault server running on this
            computer, or Custom for Docker/VPS deployments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={mode} onValueChange={(value) => setMode(value as ConnectionMode)}>
            <TabsList>
              <TabsTrigger value="hosted">Hosted</TabsTrigger>
              <TabsTrigger value="local">Local</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
            <TabsContent value="hosted" className="pt-3 text-sm text-muted-foreground">
              This agent will use <code className="rounded bg-muted px-1 py-0.5">{url}</code>.
            </TabsContent>
            <TabsContent value="local" className="pt-3 text-sm text-muted-foreground">
              Start AgentVault locally, then this agent will use{" "}
              <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:3000</code>.
            </TabsContent>
            <TabsContent value="custom" className="space-y-2 pt-3">
              <Label htmlFor="custom-url">AgentVault API URL</Label>
              <Input
                id="custom-url"
                value={customUrl}
                onChange={(event) => setCustomUrl(event.target.value)}
                placeholder="https://agentvault.example.com"
                autoComplete="url"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">2. Paste your API key</CardTitle>
          <CardDescription>
            Create as many account keys as you need in Settings → API Keys — for example,
            one each for Claude, Codex, OpenCode, and CI. Revoke one key without affecting
            the others.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="api-key" className="sr-only">
            API key
          </Label>
          <Input
            id="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={KEY_PLACEHOLDER}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">3. Connect your agent</CardTitle>
          <CardDescription>
            Paste the setup prompt into an agent, or use its configuration format below.
            The server runs on your computer and talks to{" "}
            <code className="rounded bg-muted px-1 py-0.5">{url}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CodeBlock label="Paste this into Claude Code, Codex, or OpenCode" code={setupPrompt} />
          <Tabs defaultValue="claude">
            <TabsList>
              <TabsTrigger value="claude">Claude Code</TabsTrigger>
              <TabsTrigger value="codex">Codex CLI</TabsTrigger>
              <TabsTrigger value="opencode">OpenCode</TabsTrigger>
            </TabsList>
            <TabsContent value="claude" className="space-y-4 pt-4">
              <CodeBlock label="Command" code={claudeCli} />
              <CodeBlock label="Or .mcp.json" code={claudeJson} />
            </TabsContent>
            <TabsContent value="codex" className="space-y-4 pt-4">
              <CodeBlock label="Add to ~/.codex/config.toml" code={codexToml} />
            </TabsContent>
            <TabsContent value="opencode" className="space-y-4 pt-4">
              <CodeBlock label="opencode.json" code={opencodeJson} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Good to know</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Your MCP process is local.</strong> It stores
            successful reads in{" "}
            <code className="rounded bg-muted px-1 py-0.5">~/.agentvault</code>, shows the
            last cached project memory while the server is unavailable, and queues saves and
            deletes until it reconnects.
          </p>
          <p>
            A local server and a hosted server are separate installations. Use an API key
            created by the installation selected above; a hosted key does not authenticate
            against a separate local database.
          </p>
          {packageName ? (
            <p>
              These commands install{" "}
              <code className="rounded bg-muted px-1 py-0.5">{packageName}</code> from npm, so
              they work on any machine with Node 18.18+.
            </p>
          ) : (
            <p>
              <strong className="text-foreground">The path above is on this machine.</strong>{" "}
              <code className="rounded bg-muted px-1 py-0.5">amc-mcp</code> is not published to
              npm yet, so the commands launch the built entrypoint directly — which is right
              when your agent runs on the same computer as this checkout. To connect an agent
              elsewhere, clone AgentVault there and use that path, or publish the package and
              set <code className="rounded bg-muted px-1 py-0.5">MCP_PACKAGE_NAME</code>.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
