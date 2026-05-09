import React from 'react';
import type { ToolDefinition, AddedToolInstance } from '../nodes/ToolSelectorModal';
import { ActionsSidebar } from './ActionsSidebar';

// ─── Types ─────────────────────────────────────────────────────────

// Kept for back-compat; the only meaningful mode now is 'actions'.
// The 'nodes' mode body lives in `sidebar/sections/NodesSection.tsx` and
// is mounted via <EditorSidebar> from FlowEditor.
export type SidebarMode = 'nodes' | 'actions';

export interface NodeSidebarProps {
  /** Current display mode */
  mode: SidebarMode;

  // ─── Nodes mode props (unused; kept for type back-compat) ──────────
  onAddNode: (type: string) => void;
  /** Called to collapse/hide the sidebar */
  onCollapse?: () => void;

  // ─── Actions mode props ──────────────────
  /** Close the actions panel (returns to nodes mode) */
  onClose?: () => void;
  /** All available tools from API */
  availableTools?: ToolDefinition[];
  /** Currently added tool instances on the agent node */
  addedTools?: AddedToolInstance[];
  /** Called when a tool is added. Returns the new instance ID. */
  onAddTool?: (toolId: string) => string;
  /** Called when a tool instance is removed */
  onRemoveTool?: (instanceId: string) => void;
  /** Called when an added tool instance is clicked (to open config panel) */
  onSelectTool?: (instance: AddedToolInstance) => void;
  /** Currently selected instance (to highlight) */
  selectedInstanceId?: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// Main Component — delegates the agent-tool selection sidebar.
// The 'nodes' mode now renders via <EditorSidebar>; if a caller still
// passes mode="nodes" we render nothing (callers have been migrated).
// ═══════════════════════════════════════════════════════════════════

export function NodeSidebar(props: NodeSidebarProps) {
  if (props.mode === 'actions') {
    return <ActionsSidebar {...props} />;
  }
  return null;
}
