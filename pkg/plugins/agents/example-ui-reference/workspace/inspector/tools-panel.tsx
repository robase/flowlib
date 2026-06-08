"use client"

import { Wrench, Terminal, Brain, BookOpen, Server, Globe } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentTool, ToolPolicy, ToolSource } from "@/lib/workspace/types"

const SOURCE_ICON: Record<ToolSource, typeof Wrench> = {
  core: Globe,
  sandbox: Terminal,
  mcp: Server,
  memory: Brain,
  skills: BookOpen,
}

const STATE_META = {
  enabled: { label: "Enabled", className: "text-success border-success/40" },
  "session-denied": { label: "Session denied", className: "text-warning border-warning/40" },
  "role-denied": { label: "Role denied", className: "text-destructive border-destructive/40" },
} as const

export function ToolsPanel({ tools, policy }: { tools: AgentTool[]; policy: ToolPolicy }) {
  return (
    <div className="flex h-full flex-col">
      {/* Policy summary */}
      <div className="px-4 pt-2 pb-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <PolicyStat label="Mode" value={policy.permissionMode} />
          <PolicyStat label="Allow-list" value={policy.enabledTools.length === 0 ? "all allowed" : `${policy.enabledTools.length} tools`} />
          <PolicyStat label="Output budget" value={`${policy.toolOutputBudget.lines} ln / ${policy.toolOutputBudget.bytes} B`} />
          <PolicyStat label="Session denies" value={policy.denyList.join(", ") || "none"} />
          <PolicyStat label="Role denies" value={policy.roleDenies.join(", ") || "none"} />
        </dl>
      </div>

      {/* Tool list */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3">
        {tools.map((tool) => {
          const Icon = SOURCE_ICON[tool.source]
          const meta = STATE_META[tool.state]
          return (
            <div
              key={tool.id}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-3 py-2 hover:bg-muted/40",
                tool.state !== "enabled" && "opacity-70",
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="truncate font-mono text-xs font-medium text-foreground">{tool.name}</code>
                  {tool.state !== "enabled" && (
                    <span className={cn("ml-auto shrink-0 text-[11px]", meta.className)}>{meta.label}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PolicyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[11px] capitalize text-foreground">{value}</dd>
    </div>
  )
}
