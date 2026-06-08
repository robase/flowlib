"use client"

import { cn } from "@/lib/utils"
import type { SessionStatus } from "@/lib/workspace/types"

const STATUS_STYLES: Record<SessionStatus, { dot: string; label: string }> = {
  running: { dot: "bg-info animate-pulse", label: "Running" },
  active: { dot: "bg-success", label: "Active" },
  idle: { dot: "bg-muted-foreground/50", label: "Idle" },
  error: { dot: "bg-destructive", label: "Error" },
}

export function StatusDot({ status, withLabel = false }: { status: SessionStatus; withLabel?: boolean }) {
  const s = STATUS_STYLES[status]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} aria-hidden="true" />
      {withLabel && <span className="text-xs text-muted-foreground">{s.label}</span>}
      <span className="sr-only">{s.label}</span>
    </span>
  )
}
