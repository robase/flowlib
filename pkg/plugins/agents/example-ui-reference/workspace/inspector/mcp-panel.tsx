"use client"

import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { McpServer, McpStatus } from "@/lib/workspace/types"

const STATUS_STYLE: Record<McpStatus, { dot: string; label: string; text: string }> = {
  connected: { dot: "bg-success", label: "Connected", text: "text-success" },
  disconnected: { dot: "bg-muted-foreground/40", label: "Disconnected", text: "text-muted-foreground" },
  error: { dot: "bg-destructive", label: "Error", text: "text-destructive" },
  rejected: { dot: "bg-warning", label: "Rejected by policy", text: "text-warning" },
}

export function McpPanel({
  servers,
  onToggle,
}: {
  servers: McpServer[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {servers.map((server) => {
          const status = STATUS_STYLE[server.status]
          const blocked = server.status === "rejected" || server.status === "error"
          return (
            <div key={server.id} className="rounded-lg px-3 py-2.5 hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dot)} aria-hidden="true" />
                <span className="truncate text-sm font-medium text-foreground">{server.name}</span>
                <span className="shrink-0 text-[11px] uppercase text-muted-foreground">{server.transport}</span>
                <Switch
                  className="ml-auto"
                  checked={server.enabledInSession}
                  onCheckedChange={() => onToggle(server.id)}
                  disabled={blocked}
                  aria-label={`Toggle ${server.name}`}
                />
              </div>
              <code className="mt-1.5 block truncate font-mono text-[11px] text-muted-foreground">
                {server.endpoint}
              </code>
            </div>
          )
        })}
      </div>
    </div>
  )
}
