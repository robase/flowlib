"use client"

import { useState } from "react"
import { useWorkspace } from "@/lib/workspace/use-workspace"
import { SessionList } from "./session-list"
import { ChatPane } from "./chat-pane"
import { InspectorPane, type TabId } from "./inspector/inspector-pane"
import { InspectorRail } from "./inspector-rail"
import { cn } from "@/lib/utils"

export function AgentWorkspace() {
  const store = useWorkspace()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>("memory")

  function selectTab(tab: TabId) {
    // Clicking the active tab while open closes the inspector; otherwise open + switch.
    if (inspectorOpen && tab === activeTab) {
      setInspectorOpen(false)
      return
    }
    setActiveTab(tab)
    setInspectorOpen(true)
  }

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Inspector rail — fixed to top-right of viewport */}
      <div className="fixed right-4 top-4 z-50">
        <InspectorRail open={inspectorOpen} activeTab={activeTab} onSelect={selectTab} />
      </div>
      {/* LEFT — sessions */}
      <aside className="hidden w-72 shrink-0 border-r border-border md:block">
        <SessionList
          sessions={store.sessions}
          activeSessionId={store.activeSessionId}
          onSelect={store.setActiveSessionId}
        />
      </aside>

      {/* CENTER — chat */}
      <main className="min-w-0 flex-1">
        <ChatPane
          session={store.activeSession}
          messages={store.messages}
          sending={store.sending}
          onSend={store.sendMessage}
        />
      </main>

      {/* RIGHT — inspector, animates width + slide */}
      <aside
        aria-hidden={!inspectorOpen}
        className={cn(
          "shrink-0 overflow-hidden border-l border-border transition-[width] duration-300 ease-in-out",
          inspectorOpen ? "w-96 border-l" : "w-0 border-l-0",
        )}
      >
        <div
          className={cn(
            "h-full w-96 transition-transform duration-300 ease-in-out",
            inspectorOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <InspectorPane store={store} tab={activeTab} />
        </div>
      </aside>
    </div>
  )
}
