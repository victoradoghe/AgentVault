"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Search, Trash2, Plus, FileText } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CategoryBadge } from "@/components/category-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MemoryForm } from "@/components/memory-form";
import {
  CATEGORY_FILTER_ALL,
  type MemoryInput,
} from "@/lib/validation";
import {
  MEMORY_CATEGORIES,
  categoryLabel,
  importanceLabel,
  type MemoryCategory,
} from "@/lib/categories";
import {
  api,
  ApiError,
  type MemoryInput as ApiMemoryInput,
  type MemoryRecord,
  type SearchResult,
} from "@/lib/api/client";

type Row = MemoryRecord & { score?: number };

/**
 * Normalise the form's values to the API payload. `MemoryInput.importance` is
 * typed `unknown` upstream (a quirk of the `z.ZodType<Importance>` cast in
 * categories.ts); the form always yields a numeric 1–5, so coerce it here.
 */
function toApiInput(values: MemoryInput): ApiMemoryInput {
  return {
    title: values.title,
    content: values.content,
    category: values.category,
    importance: values.importance == null ? undefined : Number(values.importance),
  };
}

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [projectName, setProjectName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"browse" | "search">("browse");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [contextMd, setContextMd] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const category = filter === CATEGORY_FILTER_ALL ? undefined : filter;
      const memories = await api.listMemories(slug, category);
      setRows(memories);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load memories.");
      setRows([]);
    }
  }, [slug, filter]);

  // Resolve the project name once (nice header; the API is slug-scoped otherwise).
  useEffect(() => {
    api
      .listProjects()
      .then((ps) => setProjectName(ps.find((p) => p.slug === slug)?.name ?? slug))
      .catch(() => setProjectName(slug));
  }, [slug]);

  useEffect(() => {
    if (mode === "browse") void load();
  }, [mode, load]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setMode("browse");
      return;
    }
    setSearching(true);
    setMode("search");
    setRows(null);
    try {
      const results: SearchResult[] = await api.searchMemories(slug, q);
      setRows(results);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Search failed.");
      setRows([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setMode("browse");
  };

  const createMemory = async (values: MemoryInput) => {
    setSaving(true);
    try {
      await api.createMemory(slug, toApiInput(values));
      toast.success("Memory saved.");
      setCreating(false);
      setMode("browse");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save memory.");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (values: MemoryInput) => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateMemory(editing.id, toApiInput(values));
      toast.success("Memory updated.");
      setEditing(null);
      if (mode === "browse") await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update memory.");
    } finally {
      setSaving(false);
    }
  };

  const removeMemory = async (row: Row) => {
    if (!confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteMemory(row.id);
      toast.success("Memory deleted.");
      setRows((cur) => cur?.filter((r) => r.id !== row.id) ?? cur);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete memory.");
    }
  };

  const viewContext = async () => {
    try {
      const md = await api.getContext(slug);
      setContextMd(md || "_This project has no memories yet._");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load context.");
    }
  };

  const deleteProject = async () => {
    if (!confirm(`Delete project "${projectName ?? slug}" and ALL its memories? This cannot be undone.`))
      return;
    try {
      await api.deleteProject(slug);
      toast.success("Project deleted.");
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete project.");
    }
  };

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        All projects
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{projectName ?? slug}</h1>
          <p className="font-mono text-xs text-muted-foreground">{slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={viewContext}>
            <FileText className="mr-1 h-4 w-4" />
            View context
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New memory
          </Button>
        </div>
      </div>

      {/* Controls: search + category filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Semantic search…"
              className="w-64 pl-8"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={runSearch} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
          {mode === "search" && (
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              Clear
            </Button>
          )}
        </div>

        {mode === "browse" && (
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="ml-auto w-52">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CATEGORY_FILTER_ALL}>All categories</SelectItem>
              {MEMORY_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {categoryLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          {mode === "search"
            ? "No memories matched your search."
            : "No memories yet. Create one, or let an agent save them via MCP."}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-44">Category</TableHead>
                <TableHead className="w-28">Importance</TableHead>
                {mode === "search" && <TableHead className="w-20">Score</TableHead>}
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.title}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                      {row.content}
                    </div>
                  </TableCell>
                  <TableCell>
                    <CategoryBadge category={row.category as MemoryCategory} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {importanceLabel(row.importance)}
                  </TableCell>
                  {mode === "search" && (
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.score !== undefined ? row.score.toFixed(3) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit"
                      onClick={() => setEditing(row)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label="Delete"
                      onClick={() => removeMemory(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Danger zone */}
      <div className="mt-10 border-t pt-6">
        <Button variant="outline" size="sm" className="text-destructive" onClick={deleteProject}>
          <Trash2 className="mr-1 h-4 w-4" />
          Delete project
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New memory</DialogTitle>
            <DialogDescription>Save a durable fact, decision, or convention.</DialogDescription>
          </DialogHeader>
          <MemoryForm
            mode="create"
            submitting={saving}
            onSubmit={createMemory}
            onCancel={() => setCreating(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit memory</DialogTitle>
            <DialogDescription>Changes to title/content are re-embedded automatically.</DialogDescription>
          </DialogHeader>
          {editing && (
            <MemoryForm
              mode="edit"
              submitting={saving}
              defaultValues={{
                title: editing.title,
                content: editing.content,
                category: editing.category as MemoryCategory,
                importance: editing.importance,
              }}
              onSubmit={saveEdit}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Context viewer */}
      <Dialog open={contextMd !== null} onOpenChange={(o) => !o && setContextMd(null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Project context bundle</DialogTitle>
            <DialogDescription>
              The markdown an agent loads via <code>get_project_context</code>.
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-xs">
            {contextMd}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
