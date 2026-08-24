# amc-mcp

**AgentVault** as an [MCP](https://modelcontextprotocol.io) server. It gives your coding agent (Claude Code, Codex CLI, OpenCode, …) **persistent, project-scoped memory**: load prior decisions at the start of a task, and save important ones as you go.

This is a thin stdio client of the AgentVault REST API — it contains no database and no embedding model. All it needs is your **AgentVault API key**.

**It keeps working when your connection doesn't.** Reads fall back to a local copy of what the server last returned, and memories saved offline are queued on disk and synced automatically when the connection comes back. See [Working offline](#working-offline).

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
> `pnpm --filter amc-mcp build`. (Publishing it is the only step needed to change that:
> set `MCP_PACKAGE_NAME` on the app and the dashboard generates `npx` commands instead.)

## Configuration

The server is configured entirely through environment variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AMC_API_KEY` | ✅ | — | Your AgentVault API key (`amc_…`). Sent as a Bearer token. |
| `AMC_BASE_URL` | — | `http://127.0.0.1:3000` | Where AgentVault is served. AgentVault is self-hosted, so the default is a local server; point this at your own deployment if it runs elsewhere. |
| `AMC_REQUEST_TIMEOUT_MS` | — | `90000` | Per-request abort budget. Raise it if saves time out against a slow or distant server. |
| `AMC_CACHE_DIR` | — | `~/.agentvault` | Where the offline cache and the outbox live. |
| `AMC_OFFLINE` | — | `1` | Set to `0` to disable the offline cache and queue entirely — every failure then surfaces as an error. |

## Working offline

A dropped connection degrades what the agent can *read*; it never loses what the
agent *writes*.

| Call | With no connection |
| --- | --- |
| `get_project_context` | Serves the last copy fetched for that project, prefixed with `[offline — cached 2h ago]`. |
| `list_projects` / `list_memories` | Same: last successful response, labelled with its age. |
| `search_memory` | Falls back to a **keyword** scan over every memory the cache has seen — listed, previously searched, or saved offline. Labelled, because it is not the server's semantic search — phrasing matters more. |
| `save_memory` | **Succeeds.** The memory is written to a durable on-disk queue and reported as saved-locally, so the agent does not retry or discard it. |
| `delete_memory` | Queued the same way. Deleting a memory that is itself still queued just drops it from the queue. |

Queued writes are replayed, oldest first, on the next call that reaches the
server — and on server start-up, so simply reopening your agent after getting
back online syncs the backlog. Nothing needs to be run by hand.

Each queued write is replayed exactly once: an entry is claimed with an atomic
rename before its request goes out, so the start-up drain, a concurrent tool
call, and a second agent sharing the same cache directory cannot each send the
same memory and leave you with duplicates.

Three things worth knowing:

- **Only a genuinely unreachable server triggers this.** A 401 or a 500 means
  the server answered, so it surfaces as the error it is. Serving a cached copy
  there would disguise a revoked API key as a working one.
- **The cache is keyed to your API key and base URL**, so two accounts — or a
  local dev server and the hosted one — never see each other's memories. The key
  is hashed, not stored, in the directory name.
- **A write the server later rejects is dropped, not retried forever** (e.g. the
  project was deleted while you were offline). That is logged to stderr so the
  loss is visible rather than silent.

Cached data is plain JSON under `AMC_CACHE_DIR`. To clear it, delete that
directory.

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
- **`Could not reach the AgentVault API …`** — the server is unreachable *and* nothing is cached for that call yet. Check `AMC_BASE_URL` and your connection. Once a project has been read online at least once, the same call serves the cached copy instead of failing.
- **`Saved "…" locally`** — not an error. The server was unreachable, so the memory is queued on disk and will sync on the next successful call. Don't retry: retrying creates a duplicate.
- **Memories saved offline haven't appeared** — they sync on the next call that reaches the server. Make any call (`list_projects` is cheapest) while online, and check stderr for `amc-mcp: synced N queued write(s)`. Queued files live in `AMC_CACHE_DIR/<namespace>/outbox/`.
- **`… timed out after 90s`** — the server accepted the request but was still working. The first `save_memory` after a cold start is the slow one: the server loads the embedding model (~20s) before writing. Note the write usually *completes* server-side even when the client gives up, so check with `list_memories` before saving again — otherwise you get a duplicate. Raise `AMC_REQUEST_TIMEOUT_MS` if it keeps happening.

## License

MIT
