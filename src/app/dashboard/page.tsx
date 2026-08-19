"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FolderOpen, CloudOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type ProjectSummary } from "@/lib/api/client";
import { CachedAt } from "@/components/offline-banner";
import { useOffline } from "@/components/offline-provider";
import { cacheKeys } from "@/lib/offline/cache";
import { useCachedQuery } from "@/lib/offline/use-cached-query";

export default function ProjectsPage() {
  const router = useRouter();
  const { offline } = useOffline();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(() => api.listProjects(), []);
  const {
    data: projects,
    cachedAt,
    stale,
    loading,
    error,
    refresh,
  } = useCachedQuery<ProjectSummary[]>(cacheKeys.projects(), fetchProjects);

  const createProject = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const project = await api.createProject(trimmed);
      toast.success(`Created "${project.name}".`);
      setOpen(false);
      setName("");
      refresh();
      router.push(`/dashboard/projects/${project.slug}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project is an isolated memory space — usually one per codebase.
          </p>
          {/* Only worth saying while we're actually serving the cache —
              otherwise it flickers on every warm load. */}
          <CachedAt at={stale ? cachedAt : null} />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            {/* Creating a project needs the server, so don't offer it offline. */}
            <Button disabled={offline} title={offline ? "Unavailable offline" : undefined}>
              <Plus className="mr-1 h-4 w-4" />
              New project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>
                Give it the name of your repo or codebase. A URL-safe slug is generated
                automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-app"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") createProject();
                }}
              />
            </div>
            <DialogFooter>
              <Button onClick={createProject} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : error !== null ? (
        // Nothing fetched and nothing cached — the one case with nothing to show.
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <CloudOff className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Couldn&apos;t load your projects</p>
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            Try again
          </Button>
        </Card>
      ) : projects === null || projects.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <FolderOpen className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first project to start saving memories.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/dashboard/projects/${p.slug}`}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader>
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <p className="font-mono text-xs text-muted-foreground">{p.slug}</p>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {p.memoryCount} {p.memoryCount === 1 ? "memory" : "memories"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
