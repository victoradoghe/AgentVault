"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryBadge } from "@/components/category-badge";
import {
  DEFAULT_CATEGORY,
  DEFAULT_IMPORTANCE,
  IMPORTANCE_LEVELS,
  MEMORY_CATEGORIES,
  importanceLabel,
} from "@/lib/categories";
import { memoryInputSchema, type MemoryInput } from "@/lib/validation";

export interface MemoryFormProps {
  mode?: "create" | "edit";
  defaultValues?: Partial<MemoryInput>;
  onSubmit: (values: MemoryInput) => void | Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
}

/**
 * Create/edit form for a memory. Category is a dropdown over the fixed
 * `MEMORY_CATEGORIES`; importance is a 1–5 selector with labels
 * (1 Low … 5 Critical). Validation reuses `memoryInputSchema` so the client
 * enforces exactly what the API does.
 */
export function MemoryForm({
  mode = "create",
  defaultValues,
  onSubmit,
  onCancel,
  submitting,
}: MemoryFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MemoryInput>({
    resolver: zodResolver(memoryInputSchema),
    defaultValues: {
      title: "",
      content: "",
      category: DEFAULT_CATEGORY,
      importance: DEFAULT_IMPORTANCE,
      ...defaultValues,
    },
  });

  const busy = submitting || isSubmitting;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" placeholder="Short, searchable summary" {...register("title")} />
        {errors.title && (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          rows={8}
          placeholder="The durable fact, decision, or note to remember."
          {...register("content")}
        />
        {errors.content && (
          <p className="text-sm text-destructive">{errors.content.message}</p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      <span className="flex items-center gap-2">
                        <CategoryBadge category={category} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.category && (
            <p className="text-sm text-destructive">{errors.category.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="importance">Importance</Label>
          <Controller
            control={control}
            name="importance"
            render={({ field }) => (
              <Select
                value={String(field.value)}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id="importance">
                  <SelectValue placeholder="Select importance" />
                </SelectTrigger>
                <SelectContent>
                  {IMPORTANCE_LEVELS.map((level) => (
                    <SelectItem key={level} value={String(level)}>
                      {importanceLabel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.importance && (
            <p className="text-sm text-destructive">{errors.importance.message}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Create memory"}
        </Button>
      </div>
    </form>
  );
}
