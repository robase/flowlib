/**
 * FlowViewer — Stripped-down, read-only React Flow canvas for embedding in docs.
 *
 * Renders a flow from static data with:
 * - Nodes and edges on a React Flow canvas
 * - Double-click a node to open its config panel (read-only)
 * - Agent node tool display
 * - No sidebar, toolbar, run controls, chat, or mutations
 *
 * @example
 * ```tsx
 * import { FlowViewer } from '@flowlib/ui/demo';
 * import '@flowlib/ui/styles';
 *
 * <FlowViewer
 *   nodes={[
 *     { id: '1', type: 'trigger.manual', position: { x: 0, y: 0 },
 *       data: { id: '1', type: 'trigger.manual', display_name: 'Input', reference_id: 'input', status: 'default', params: {} } },
 *     { id: '2', type: 'core.model', position: { x: 300, y: 0 },
 *       data: { id: '2', type: 'core.model', display_name: 'GPT-4', reference_id: 'gpt4', status: 'default', params: {} } },
 *   ]}
 *   edges={[{ id: 'e1-2', source: '1', target: '2' }]}
 *   nodeDefinitions={[...]}
 *   theme="dark"
 *   style={{ height: 500 }}
 * />
 * ```
 */

import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import { ThemeProvider, useTheme } from '../contexts/ThemeProvider';
import { ApiProvider } from '../contexts/ApiContext';
import { NodeRegistryProvider } from '../contexts/NodeRegistryContext';
import { PluginRegistryProvider } from '../contexts/PluginRegistryContext';
import { ValidationProvider } from '../contexts/ValidationContext';
import { UniversalNode, AgentNode, type ToolDefinition } from '../components/nodes';
import { BatchFlowEdge, defaultEdgeOptions } from '../components/graph';
import {
  AgentToolCallbacksProvider,
  type AgentToolCallbacks,
} from '../contexts/AgentToolCallbacksContext';
import { NodeConfigPanel } from '../components/flow-editor/node-config-panel/NodeConfigPanel';
import { useFlowEditorStore } from '../components/flow-editor/flow-editor.store';
import type { NodeDefinition } from '../types/node-definition.types';
import type { ReactFlowNodeData, AgentToolDefinition } from '@flowlib/core/types';
import { createDemoApiClient } from './demo-api-client';
import type { ApiClient } from '../api/client';
import '../app.css';

const EDGE_TYPES: EdgeTypes = {
  default: BatchFlowEdge,
};

const FIT_VIEW_OPTIONS = {
  duration: 0,
  padding: 0.2,
} as const;

export interface FlowViewerProps {
  /** React Flow nodes to render */
  nodes: Node<ReactFlowNodeData>[];
  /** React Flow edges to render */
  edges: Edge[];
  /** Node definitions for rendering and config panel */
  nodeDefinitions?: NodeDefinition[];
  /** Agent tool definitions (shown on agent nodes) */
  agentTools?: AgentToolDefinition[];
  /** Theme mode */
  theme?: 'light' | 'dark' | 'system';
  /** Allow double-click to open the node config panel */
  interactive?: boolean;
  /** Show React Flow controls (zoom, fit) */
  showControls?: boolean;
  /** CSS class name for the outer container */
  className?: string;
  /** Inline styles for the outer container */
  style?: React.CSSProperties;
  /** Additional class for the outer container */
  containerClassName?: string;
}

// No-op for read-only tool callbacks
const toolNoop = () => {
  // intentionally empty — viewer is read-only
};

/** Internal canvas component — must be inside ReactFlowProvider */
function FlowViewerCanvas({
  nodes,
  edges,
  nodeDefinitions = [],
  agentTools = [],
  interactive = true,
  showControls = true,
}: Omit<FlowViewerProps, 'theme' | 'className' | 'style' | 'containerClassName'>) {
  const { resolvedTheme } = useTheme();
  const dialogContainerRef = useRef<HTMLDivElement | null>(null);

  // Config panel state
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Sync nodes into Zustand store so NodeConfigPanel can read them
  const syncFromServer = useFlowEditorStore((s) => s.syncFromServer);
  const setFlowId = useFlowEditorStore((s) => s.setFlowId);

  useEffect(() => {
    setFlowId('demo-flow', undefined);
    syncFromServer(nodes, edges, 'demo-flow:1');
  }, [nodes, edges, syncFromServer, setFlowId]);

  // Build nodeTypes mapping from definitions
  const nodeTypes: NodeTypes = useMemo(() => {
    // eslint-disable-next-line typescript/no-explicit-any
    const mapping: Record<string, React.ComponentType<any>> = {
      'core.agent': AgentNode,
      default: UniversalNode,
    };
    for (const def of nodeDefinitions) {
      if (!(def.type in mapping)) {
        mapping[def.type] = UniversalNode;
      }
    }
    return mapping;
  }, [nodeDefinitions]);

  // Transform agent tools for context
  const availableTools: ToolDefinition[] = useMemo(
    () =>
      agentTools
        .filter((tool) => tool.provider?.id !== 'triggers' && !tool.id.startsWith('trigger.'))
        .map((tool) => ({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          category: tool.category as ToolDefinition['category'],
          tags: tool.tags,
          inputSchema: tool.inputSchema,
          nodeType: tool.nodeType,
          provider: tool.provider,
        })),
    [agentTools],
  );

  // Agent tool callbacks (read-only — no mutations in viewer mode)
  const agentToolCallbacks = useMemo<AgentToolCallbacks>(
    () => ({
      onOpenToolSelector: toolNoop,
      onShowMoreTools: toolNoop,
      onRemoveTool: toolNoop,
      onToolClick: toolNoop,
      availableTools,
      selectedToolNodeId: null,
      selectedToolInstanceId: null,
    }),
    [availableTools],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, clickedNode: Node) => {
      if (!interactive) {
        return;
      }
      setSelectedNodeId(clickedNode.id);
      setConfigPanelOpen(true);
    },
    [interactive],
  );

  const handlePanelOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfigPanelOpen(false);
      setSelectedNodeId(null);
    }
  }, []);

  return (
    <div
      ref={dialogContainerRef}
      style={{ width: '100%', height: '100%', background: 'var(--canvas-background)' }}
    >
      <AgentToolCallbacksProvider value={agentToolCallbacks}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={defaultEdgeOptions}
          colorMode={resolvedTheme}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          onNodeDoubleClick={interactive ? handleNodeDoubleClick : undefined}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={interactive}
          panOnScroll
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
        >
          {showControls && <Controls />}
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        </ReactFlow>
      </AgentToolCallbacksProvider>

      {interactive && (
        <NodeConfigPanel
          open={configPanelOpen}
          nodeId={selectedNodeId}
          flowId="demo-flow"
          onOpenChange={handlePanelOpenChange}
          portalContainer={dialogContainerRef.current}
          availableTools={availableTools}
        />
      )}
    </div>
  );
}

/**
 * Self-contained flow viewer with all necessary providers.
 * Renders React Flow canvas with Flowlib node styling.
 */
export function FlowViewer({
  theme = 'dark',
  className,
  style,
  containerClassName,
  nodeDefinitions = [],
  agentTools = [],
  ...canvasProps
}: FlowViewerProps) {
  // Create a stable QueryClient for the viewer
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: Infinity, retry: false },
        },
      }),
    [],
  );

  // Create mock API client with the node definitions and agent tools
  const mockClient = useMemo(
    () =>
      createDemoApiClient({
        nodeDefinitions,
        agentTools,
      }) as unknown as ApiClient,
    [nodeDefinitions, agentTools],
  );

  return (
    <div
      className={containerClassName}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
    >
      <ThemeProvider defaultTheme={theme} storageKey="flowlib-viewer-theme" className={className}>
        <QueryClientProvider client={queryClient}>
          <ApiProvider apiClient={mockClient}>
            <PluginRegistryProvider plugins={[]}>
              <ValidationProvider>
                <NodeRegistryProvider>
                  <ReactFlowProvider>
                    <FlowViewerCanvas
                      nodeDefinitions={nodeDefinitions}
                      agentTools={agentTools}
                      {...canvasProps}
                    />
                  </ReactFlowProvider>
                </NodeRegistryProvider>
              </ValidationProvider>
            </PluginRegistryProvider>
          </ApiProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </div>
  );
}
