"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type ApiKeySummary, type CreatedApiKey } from "@/lib/api/client";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    api
      .listKeys()
      .then(setKeys)
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : "Failed to load keys.");
        setKeys([]);
      });

  useEffect(() => {
    void load();
  }, []);

  const createKey = async () => {
    setCreating(true);
    try {
      const key = await api.createKey(label.trim() || undefined);
      setRevealed(key);
      setLabel("");
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create key.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKeySummary) => {
    if (!confirm(`Revoke ${key.label ?? key.maskedKey}? Agents using it will stop working.`)) return;
    try {
      await api.revokeKey(key.id);
      toast.success("Key revoked.");
      setKeys((cur) => cur?.filter((k) => k.id !== key.id) ?? cur);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke key.");
    }
  };

  const copyKey = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-sm text-muted-foreground">
            Keys authenticate the <code className="text-xs">amc-mcp</code> server. See{" "}
            <Link href="/dashboard/mcp-setup" className="underline underline-offset-4">
              MCP Setup
            </Link>{" "}
            to connect your agent.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New key
        </Button>
      </div>

      {keys === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <KeyRound className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">No API keys yet</p>
            <p className="text-sm text-muted-foreground">
              Create one to connect a coding agent.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <Card key={k.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{k.label ?? "Untitled key"}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {k.maskedKey}
                    </code>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {formatDate(k.createdAt)} · Last used {formatDate(k.lastUsedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive"
                  aria-label="Revoke key"
                  onClick={() => revoke(k)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Give it a label so you can tell your keys apart (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="key-label">Label</Label>
            <Input
              id="key-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. laptop-claude-code"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") createKey();
              }}
            />
          </div>
          <DialogFooter>
            <Button onClick={createKey} disabled={creating}>
              {creating ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal dialog — shown once, right after creation */}
      <Dialog open={revealed !== null} onOpenChange={(o) => !o && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>
              This is the only time the full key is shown. Store it somewhere safe — you
              can&apos;t view it again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
              {revealed?.key}
            </code>
            <Button variant="outline" size="icon" onClick={copyKey} aria-label="Copy key">
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
