// Export all graph components

// Export new Invect-inspired components
export { BatchFlowEdge, defaultEdgeOptions } from './BatchFlowEdge';
export { LayoutSelector } from './LayoutSelector';

export { langflowColors, type NodeStatus } from './styleUtils';
export type { BatchFlowEdgeData } from './BatchFlowEdge';

// Import types from core
import type { NodeExecutionStatus } from '@flowlib/core/types';

// Types matching Invect's node structure, extending ReactFlow's expected types
export interface BatchFlowNodeData extends Record<string, unknown> {
  id: string;
  type: string; // This is the key used for style mapping, e.g., "OpenAIModel"
  display_name: string;
  description?: string;
  icon?: string; // Invect's icon name (e.g., "OpenAI", "MessagesSquare")
  frozen?: boolean;
  beta?: boolean;
  deprecated?: boolean;
  outputs?: Array<{
    name: string;
    display_name: string;
    type: string; // Data type, e.g., "text", "ChatHistory"
    required?: boolean;
  }>;
  inputs?: Array<{
    name: string;
    display_name: string;
    type: string; // Data type
    required?: boolean;
    value?: unknown;
  }>;
  template?: Record<
    string,
    {
      // Parameters
      display_name: string;
      type: string; // Parameter type, e.g., "str", "int", "bool", "code"
      required?: boolean;
      show?: boolean; // Whether to show in the UI by default
      value?: unknown;
      options?: unknown[]; // For dropdowns
      list?: boolean; // If it's a list input
      multiline?: boolean; // For text areas
      placeholder?: string;
      password?: boolean;
      advanced?: boolean; // If it's an advanced parameter
      _input_type?: string; // Invect input type for handle generation
    }
  >;
  connectedTemplateFields?: Set<string>; // Set of template field names that are connected
  executionStatus?: NodeExecutionStatus; // Execution status from backend
  executionError?: string; // Execution error message
  executionOutput?: unknown; // Output data from completed node execution
  // selected?: boolean; // Provided by NodeProps
  // showNode?: boolean; // Invect specific, might map to a local state like isExpanded
  flow?: unknown; // Flow context if needed
}
