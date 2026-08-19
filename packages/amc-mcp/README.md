# amc-mcp

**AgentVault** as an [MCP](https://modelcontextprotocol.io) server. It gives your coding agent (Claude Code, Codex CLI, OpenCode, …) **persistent, project-scoped memory**: load prior decisions at the start of a task, and save important ones as you go.

This is a thin stdio client of the AgentVault REST API — it stores nothing locally and contains no database. All it needs is your **AgentVault API key**.

## Tools

| Tool | What it does |
| --- | --- |
| `list_projects` | List the memory projects available to your API key. |
| `get_project_context(project_slug)` | **Load my memory** — returns the full markdown context bundle for a project. Call this at the start of a task. |
| `search_memory(project_slug, query, limit?)` | Semantic search over a project's memories. |
| `save_memory(project_slug, title, content, category?, importance?)` | Save an important decision/fact. Call this whenever a meaningful decision is made. |
| `list_memories(project_slug, category?)` | List a project's memories, optionally by category. |
| `delete_memory(memory_id)` | Permanently delete one memory. |

## Prerequisites

1. An AgentVault account and an **API key** (looks like `amc_…`). Create one in the AgentVault dashboard under **Settings → API Keys**.
2. Node.js 18.18+.

> **The dashboard writes these commands for you.** Open **Dashboard → Connect your agent**,
> paste your API key, and copy a command with the key and base URL already filled in.
> That page is the easiest path; everything below is the manual equivalent.

> **`npx -y amc-mcp` does not work yet** — this package is not published to npm.
> Launch the built entrypoint by absolute path instead, as shown below. Build it once with
> `pnpm --filter amc-mcp build`.

## Configuration

The server is configured entirely through environment variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AMC_API_KEY` | ✅ | — | Your AgentVault API key (`amc_…`). Sent as a Bearer token. |
| `AMC_BASE_URL` | — | `https://agent-memory-cloud.vercel.app` | Override to point at a local dev server, e.g. `http://localhost:3000`. |
| `AMC_REQUEST_TIMEOUT_MS` | — | `90000` | Per-request abort budget. Raise it if saves time out against a slow or distant server. |

---

### Claude Code

**Option A — CLI (recommended):**

```bash
claude mcp add amc \
  -e AMC_API_KEY=amc_your_key_here \
  -- node /absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js
```

**Option B — project `.mcp.json`** (commit it to share with your team; keep the key in an env var, not the file):

```json
{
  "mcpServers": {
    "amc": {
      "command": "node",
      "args": ["/absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js"],
      "env": {
        "AMC_API_KEY": "amc_your_key_here"
      }
    }
  }
}
```

Restart Claude Code, then run `/mcp` to confirm `amc` is connected.

---

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.amc]
command = "node"
args = ["/absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js"]
env = { AMC_API_KEY = "amc_your_key_here" }
```

---

### OpenCode

Add to your `opencode.json` (project root) or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "amc": {
      "type": "local",
      "command": ["node", "/absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js"],
      "environment": {
        "AMC_API_KEY": "amc_your_key_here"
      },
      "enabled": true
    }
  }
}
```

---

## Pointing at a local dev server

For local AgentVault development, set `AMC_BASE_URL` to your dev server. For Claude Code:

```bash
claude mcp add amc-dev \
  -e AMC_API_KEY=amc_your_key_here \
  -e AMC_BASE_URL=http://localhost:3000 \
  -- node /absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js
```

For Codex/OpenCode, add `AMC_BASE_URL` alongside `AMC_API_KEY` in the `env` / `environment` block above.

## Running from source (contributors)

Until the package is published to npm, run the built entrypoint directly:

```bash
pnpm --filter amc-mcp install
pnpm --filter amc-mcp build      # emits dist/
AMC_API_KEY=amc_your_key_here node packages/amc-mcp/dist/index.js
```

To register the local build with Claude Code, point `command` at `node` and pass the absolute path to `dist/index.js`:

```bash
claude mcp add amc-local \
  -e AMC_API_KEY=amc_your_key_here \
  -e AMC_BASE_URL=http://localhost:3000 \
  -- node /absolute/path/to/agent-memory-cloud/packages/amc-mcp/dist/index.js
```

## How agents should use it

- **At the start of a task**, call `get_project_context` to load prior decisions, conventions, and gotchas.
- **When an important decision is made** (architecture, a convention, a non-obvious constraint, a fix that worked), call `save_memory` with a specific title and the *why*.
- Use `search_memory` for targeted recall mid-task.

## Troubleshooting

- **`AMC_API_KEY is not set`** — the env var is missing from your MCP config. Add it and restart your agent.
- **`Authentication failed (401)`** — the key is wrong, revoked, or malformed. Generate a new one in the dashboard.
- **`Could not reach the AgentVault API …`** — the server is unreachable. Check `AMC_BASE_URL` and your connection; this error is transient and safe to retry.
- **`… timed out after 90s`** — the server accepted the request but was still working. The first `save_memory` after a cold start is the slow one: the server loads the embedding model (~20s) before writing. Note the write usually *completes* server-side even when the client gives up, so check with `list_memories` before saving again — otherwise you get a duplicate. Raise `AMC_REQUEST_TIMEOUT_MS` if it keeps happening.

## License

MIT
