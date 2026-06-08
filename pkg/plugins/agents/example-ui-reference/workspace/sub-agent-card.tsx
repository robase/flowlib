"use client"

import { useState } from "react"
import { ChevronRight, GitBranch, Check, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SubAgentRun } from "@/lib/workspace/types"
import { ToolCallCard } from "./tool-call-card"

const STATUS_META = {
  success: { icon: Check, className: "text-success" },
  error: { icon: X, className: "text-destructive" },
  running: { icon: Loader2, className: "text-info animate-spin" },
} as const

export function SubAgentCard({ run }: { run: SubAgentRun }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[run.status]
  const StatusIcon = meta.icon

  return (
    <div className="overflow-hidden rounded-md border border-primary/30 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">sub-agent</span>
            <code className="font-mono text-xs text-primary">{run.name}</code>
            <StatusIcon className={cn("ml-auto h-3.5 w-3.5", meta.className)} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{run.task}</p>
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-primary/20 px-3 py-2.5">
          {run.summary && (
            <p className="text-xs leading-relaxed text-foreground">{run.summary}</p>
          )}
          {run.toolCalls && run.toolCalls.length > 0 && (
            <div className="space-y-1.5 border-l-2 border-primary/20 pl-3">
              {run.toolCalls.map((c) => (
                <ToolCallCard key={c.id} call={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
