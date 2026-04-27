import { Node, NodeProps } from '@xyflow/react';
import { NodeExecutionStatus } from '@flowlib/core/types';

// New universal node component
export { UniversalNode } from './UniversalNode';

// Agent node with tools box
export { AgentNode } from './AgentNode';
export { NodeAppendix, type AppendixPosition } from './NodeAppendix';
export { AgentToolsBox, type AgentToolDisplay, type ToolCategory } from './AgentToolsBox';
export { type ToolDefinition, type AddedToolInstance } from './ToolSelectorModal';
export { ToolParamField, type AddCredentialRequest } from './ToolParamField';

// Node status indicator for showing execution status
export {
  NodeStatusIndicator,
  type NodeStatusIndicatorStatus,
  type NodeStatusIndicatorLoadingVariant,
} from './NodeStatusIndicator';

// Context-based node utilities
export {
  NodeViewProvider,
  useNodeViewContext,
  type NodeViewMode,
  type NodeViewProviderProps,
} from './NodeViewContext';
export { withNodeContext } from './withNodeContext';
export { createContextAwareNodes } from './createContextAwareNodes';

// Export from node registry
export { NODE_COMPONENTS, getNodeComponent, type NodeComponentType } from './nodeRegistry';

// Common node data interface
export interface BaseNodeData {
  // display_name?: string;
  description?: string;
  icon?: string;
  status?: string;
  executionStatus?: NodeExecutionStatus;
  executionOutput?: unknown;
  executionError?: string;
}

export type FBNodeProps<T> = NodeProps<Node<T & BaseNodeData & Record<string, unknown>>>;
