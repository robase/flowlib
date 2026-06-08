/**
 * InspectorPane — the slide-out right panel. Hosts the five workspace
 * inspector sections; the active tab is driven by `InspectorRail`.
 *
 * Data wiring varies by section maturity:
 *   - MCP / Skills      → real backends (REST CRUD + per-session opt-in)
 *   - Tools             → the active session's tool policy (real fields)
 *   - Memory / Hooks    → backends not yet exposed; honest empty states
 */
import * as React from 'react';
import { Brain, BookOpen, Server, Wrench, ShieldAlert } from 'lucide-react';
import type { AgentSession } from '../../../shared/types';
import { MemoryPanel } from './MemoryPanel';
import { SkillsPanel } from './SkillsPanel';
import { McpPanel } from './McpPanel';
import { ToolsPanel } from './ToolsPanel';
import { HooksPanel } from './HooksPanel';

export type TabId = 'memory' | 'skills' | 'mcp' | 'tools' | 'hooks';

export const INSPECTOR_TABS: {
  id: TabId;
  label: string;
  icon: typeof Brain;
}[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'mcp', label: 'MCP servers', icon: Server },
  { id: 'tools', label: 'Tools & permissions', icon: Wrench },
  { id: 'hooks', label: 'Hooks & audit', icon: ShieldAlert },
];

export interface InspectorPaneProps {
  tab: TabId;
  /** The active chat session, when one is open. Drives MCP / Tools. */
  session: AgentSession | null;
}

export function InspectorPane({ tab, session }: InspectorPaneProps): React.ReactElement {
  const active = INSPECTOR_TABS.find((t) => t.id === tab) ?? INSPECTOR_TABS[0];

  return (
    <div className="flex h-full flex-col bg-card pr-10">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">{active.label}</h2>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'memory' && <MemoryPanel />}
        {tab === 'skills' && <SkillsPanel />}
        {tab === 'mcp' && <McpPanel session={session} />}
        {tab === 'tools' && <ToolsPanel session={session} />}
        {tab === 'hooks' && <HooksPanel />}
      </div>
    </div>
  );
}
