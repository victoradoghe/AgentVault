"use client";

import { CloudOff } from "lucide-react";

import { useOffline } from "@/components/offline-provider";

/**
 * The "you're seeing cached data" strip.
 *
 * It sits under the nav on every dashboard page and is the one place that
 * explains the read-only state, so individual pages only have to disable their
 * buttons rather than each inventing their own explanation.
 */
export function OfflineBanner() {
  const { offline } = useOffline();
  if (!offline) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-2 text-sm">
        <CloudOff className="h-4 w-4 shrink-0" />
        <span>
          <strong className="font-medium">Offline</strong> — showing memories cached on
          this device. Editing is disabled until the connection is back.
        </span>
      </div>
    </div>
  );
}

/**
 * Inline note for a specific view, naming when its data was captured.
 *
 * The banner above says "some of this is cached"; this says "*this table* is
 * from 14:02", which is what actually decides whether a user trusts what they
 * are reading.
 */
export function CachedAt({ at }: { at: number | null }) {
  if (at === null) return null;

  const when = new Date(at);
  const isToday = when.toDateString() === new Date().toDateString();
  const formatted = isToday
    ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : when.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <p className="text-xs text-muted-foreground">
      Cached {isToday ? "at" : "on"} {formatted}
    </p>
  );
}
