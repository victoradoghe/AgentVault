import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CATEGORY_META,
  DEFAULT_CATEGORY,
  type MemoryCategory,
} from "@/lib/categories";

/**
 * A category pill with a distinct, theme-aware color per category. Drop it into
 * dashboard tables so rows are scannable at a glance. Colors come from the
 * single source of truth in `@/lib/categories` (CATEGORY_META).
 */
export function CategoryBadge({
  category,
  className,
}: {
  category: MemoryCategory;
  className?: string;
}) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META[DEFAULT_CATEGORY];
  return (
    <Badge
      variant="outline"
      title={meta.description}
      className={cn("font-medium", meta.badgeClass, className)}
    >
      {meta.label}
    </Badge>
  );
}
