/**
 * Agent Tool Types for Frontend
 *
 * Types for displaying and managing agent tools in the UI.
 * These align with AgentToolDefinition from @flowlib/core.
 */

import type { AppendixPosition } from '../components/nodes/NodeAppendix';

/**
 * Tool category for organization in UI
 * Matches AgentToolCategory from @flowlib/core
 */
export type ToolCategory = 'data' | 'web' | 'code' | 'utility' | 'custom';

/**
 * Simplified tool definition for display in the UI
 * Matches the essential fields from AgentToolDefinition in core
 */
export interface AgentToolDisplay {
  /** Unique tool identifier (snake_case) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool category for organization and styling */
  category: ToolCategory;
  /** Description (optional for display, shown in tooltips) */
  description?: string;
}

/**
 * Convert from backend AgentToolDefinition to frontend display format
 * This is a utility type - the actual conversion is done in components
 */
export type AgentToolDefinitionToDisplay<
  T extends { id: string; name: string; category: ToolCategory; description?: string },
> = Pick<T, 'id' | 'name' | 'category' | 'description'>;

/**
 * Agent node data extensions for tools
 */
export interface AgentNodeToolsData {
  /** Resolved tools for display (populated by frontend from API) */
  tools?: AgentToolDisplay[];
  /** Position of the tools appendix */
  toolsPosition?: AppendixPosition;
}

/**
 * Event handlers for agent tool interactions
 */
export interface AgentToolHandlers {
  /** Called when user clicks "Add Tool" button */
  onAddTool?: () => void;
  /** Called when user clicks on a tool (to configure it) */
  onToolClick?: (tool: AgentToolDisplay) => void;
  /** Called when user clicks remove button on a tool */
  onRemoveTool?: (toolId: string) => void;
  /** Called when user changes the tools appendix position */
  onToolsPositionChange?: (position: AppendixPosition) => void;
}

// Re-export for convenience
export type { AppendixPosition };
