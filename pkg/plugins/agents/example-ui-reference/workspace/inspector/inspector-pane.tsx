'use client';

import { Brain, BookOpen, Server, Wrench, ShieldAlert } from 'lucide-react';
import type { WorkspaceStore } from '@/lib/workspace/use-workspace';
import { MemoryPanel } from './memory-panel';
import { SkillsPanel } from './skills-panel';
import { McpPanel } from './mcp-panel';
import { ToolsPanel } from './tools-panel';
import { HooksPanel } from './hooks-panel';

export type TabId = 'memory' | 'skills' | 'mcp' | 'tools' | 'hooks';

export const INSPECTOR_TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'mcp', label: 'MCP servers', icon: Server },
  { id: 'tools', label: 'Tools & permissions', icon: Wrench },
  { id: 'hooks', label: 'Hooks & audit', icon: ShieldAlert },
];

export function InspectorPane({ store, tab }: { store: WorkspaceStore; tab: TabId }) {
  const active = INSPECTOR_TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full flex-col bg-card pr-10">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">{active.label}</h2>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'memory' && (
          <MemoryPanel memories={store.memories} onDelete={store.deleteMemory} />
        )}
        {tab === 'skills' && <SkillsPanel skills={store.skills} onToggle={store.toggleSkill} />}
        {tab === 'mcp' && <McpPanel servers={store.mcpServers} onToggle={store.toggleMcpServer} />}
        {tab === 'tools' && <ToolsPanel tools={store.tools} policy={store.toolPolicy} />}
        {tab === 'hooks' && <HooksPanel hooks={store.hooks} events={store.auditEvents} />}
      </div>
    </div>
  );
}
