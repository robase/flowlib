'use client';

import { memo } from 'react';
import { Plus, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ProviderIcon } from '../shared/ProviderIcon';
import type { AddedToolInstance, ToolDefinition } from './ToolSelectorModal';

/**
 * Tool category for organization in UI
 * Matches AgentToolCategory from @flowlib/core
 */
export type ToolCategory = 'data' | 'web' | 'code' | 'utility' | 'custom';

/**
 * Simplified tool definition for display in the UI
 * @deprecated Use AddedToolInstance instead
 */
export interface AgentToolDisplay {
  id: string;
  name: string;
  category: ToolCategory;
}

interface AgentToolsBoxProps {
  /** Tool instances currently attached to the agent */
  tools: AddedToolInstance[];
  /** Available tool definitions for resolving category info */
  availableTools: ToolDefinition[];
  /** Currently selected tool instance ID (being configured) */
  selectedInstanceId?: string | null;
  /** Called when user clicks "Add Tool" button */
  onAddTool?: () => void;
  /** Called when user wants to see all selected tools (opens modal with filter) */
  onShowMore?: () => void;
  /** Called when user clicks on a tool (to configure it) */
  onToolClick?: (tool: AddedToolInstance) => void;
  /** Called when user clicks remove button on a tool */
  onRemoveTool?: (instanceId: string) => void;
  /** Additional CSS classes */
  className?: string;
}

// Maximum visible tools in grid (2 columns x 3 rows)
const MAX_VISIBLE_TOOLS = 6;

/**
 * ToolTile - Compact square tile for displaying a tool in the grid
 */
const ToolTile = memo(function ToolTile({
  tool,
  toolDef,
  isSelected,
  onToolClick,
  onRemoveTool: _onRemoveTool,
}: {
  tool: AddedToolInstance;
  toolDef: ToolDefinition | undefined;
  isSelected?: boolean;
  onToolClick?: (tool: AddedToolInstance) => void;
  onRemoveTool?: (instanceId: string) => void;
}) {
  return (
    <div
      className={cn(
        'group relative flex flex-row items-center p-1 gap-1 rounded-md border cursor-pointer transition-colors w-[99px]',
        'hover:bg-accent hover:border-accent-foreground/20',
        isSelected && 'bg-accent border-primary ring-1 ring-primary/30',
      )}
      onClick={() => onToolClick?.(tool)}
      title={tool.name}
    >
      {toolDef?.provider?.svgIcon || toolDef?.provider?.icon || toolDef?.provider?.id ? (
        <ProviderIcon
          providerId={toolDef?.provider?.id}
          svgIcon={toolDef?.provider?.svgIcon}
          icon={toolDef?.provider?.icon}
          className="w-5 h-5 shrink-0"
        />
      ) : null}
      <span className="text-[10px] truncate w-full">{tool.name}</span>
    </div>
  );
});

/**
 * AgentToolsBox - Displays and manages tools attached to an AI Agent node
 *
 * Renders as a compact grid showing tool tiles with category-based styling.
 * Shows max 2x3 grid with "show more" button if there are more tools.
 */
export const AgentToolsBox = memo(function AgentToolsBox({
  tools,
  availableTools,
  selectedInstanceId,
  onAddTool,
  onShowMore,
  onToolClick,
  onRemoveTool,
  className,
}: AgentToolsBoxProps) {
  const isEmpty = tools.length === 0;
  const hasMoreTools = tools.length > MAX_VISIBLE_TOOLS;
  const visibleTools = hasMoreTools ? tools.slice(0, MAX_VISIBLE_TOOLS - 1) : tools;
  const hiddenCount = tools.length - visibleTools.length;

  // Helper to get tool definition by toolId
  const getToolDef = (toolId: string) => availableTools.find((t) => t.id === toolId);

  return (
    <div className={cn('w-[220px] p-2', className)}>
      {/* Header - only show if we have tools */}
      {!isEmpty && (
        <div className="mb-2 text-xs font-medium text-muted-foreground">Tools ({tools.length})</div>
      )}

      {isEmpty ? (
        /* Empty state - prominent add button */
        onAddTool && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onAddTool();
            }}
            className="flex flex-col items-center justify-center w-full gap-2 p-4 transition-all border-2 border-dashed rounded-lg border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
              <Plus className="w-5 h-5" />
            </div>
            <div className="text-center">
              <div className="text-xs font-medium">Add Tools</div>
              <div className="text-[10px] opacity-70">Give the agent capabilities</div>
            </div>
          </button>
        )
      ) : (
        /* Tools grid */
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            {visibleTools.map((tool) => (
              <ToolTile
                key={tool.instanceId}
                tool={tool}
                toolDef={getToolDef(tool.toolId)}
                isSelected={selectedInstanceId === tool.instanceId}
                onToolClick={onToolClick}
                onRemoveTool={onRemoveTool}
              />
            ))}

            {/* Show more button - takes place of last tile when there are more tools */}
            {hasMoreTools && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onShowMore?.();
                }}
                className="flex items-center justify-center transition-colors border border-dashed rounded-md cursor-pointer border-muted-foreground/50 text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5"
                title={`Show ${hiddenCount} more tools`}
              >
                <span className="text-[10px]">+{hiddenCount} more</span>
              </button>
            )}
          </div>

          {/* Configure button */}
          {onAddTool && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddTool();
              }}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-muted-foreground/50 px-2 py-1.5 text-xs text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <Settings className="w-3 h-3" />
              <span>Configure</span>
            </button>
          )}
        </div>
      )}

      {/* Empty state - only show if no add button */}
      {isEmpty && !onAddTool && (
        <div className="text-xs italic text-muted-foreground/60">No tools configured</div>
      )}
    </div>
  );
});

AgentToolsBox.displayName = 'AgentToolsBox';
