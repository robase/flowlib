"use client"

import { cn } from "@/lib/utils"
import { INSPECTOR_TABS, type TabId } from "./inspector/inspector-pane"

interface InspectorRailProps {
  open: boolean
  activeTab: TabId
  onSelect: (tab: TabId) => void
}

export function InspectorRail({ open, activeTab, onSelect }: InspectorRailProps) {
  return (
    <nav aria-label="Workspace inspector sections" className="flex flex-col items-center gap-3">
      {INSPECTOR_TABS.map((t) => {
        const isActive = open && t.id === activeTab
        return (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={isActive}
            onClick={() => onSelect(t.id)}
            className={cn(
              "flex h-7 w-7 items-center justify-center transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-[18px] w-[18px]" />
          </button>
        )
      })}
    </nav>
  )
}
