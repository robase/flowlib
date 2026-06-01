import React, { useCallback, useMemo, useRef } from 'react';
import {
  NodeTypes,
  EdgeTypes,
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  SelectionMode,
  useReactFlow,
  useNodesInitialized,
  type Node,
} from '@xyflow/react';
import { BatchFlowEdge, defaultEdgeOptions } from '../graph';
import { LayoutSelector } from '../graph/LayoutSelector';
import { UniversalNode, AgentNode } from '../nodes';
import { getNodeComponent } from '../nodes/nodeRegistry';
import { NodeConfigPanel } from './node-config-panel/NodeConfigPanel';
import { AgentToolCallbacksProvider } from '~/contexts/AgentToolCallbacksContext';
import { applyLayout, type LayoutAlgorithm } from '~/utils/layoutUtils';
import { useTheme } from '~/contexts/ThemeProvider';
import { useNodeRegistry } from '~/contexts/NodeRegistryContext';
import { useFlowEditorStore } from './flow-editor.store';
import { useCopyPaste } from './use-copy-paste';
import { useKeyboardShortcuts } from './use-keyboard-shortcuts';
import { FlowCommandPalette } from './FlowCommandPalette';
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog';
import { useNodeCreation } from './use-node-creation';
import { useRunDataFromQueryParams } from './use-run-data-from-query-params';
import type { ToolPanelApi } from './use-tool-panel';
import type { NodeExecutionStatus } from '@flowlib/core/types';

// Stable references for React Flow - defined at module scope to avoid re-renders
const EDGE_TYPES: EdgeTypes = {
  default: BatchFlowEdge,
};

const FIT_VIEW_OPTIONS = {
  duration: 0,
  padding: 0.2,
} as const;

interface FlowWorkbenchViewProps {
  flowId: string;
  /** App-mount path prefix (e.g. '/flowlib'). Reserved for child needs; unused today. */
  basePath?: string;
  onRegisterAddNode?: (fn: (type: string) => void) => void;
  onLayoutSelectorRender?: (layoutSelector: React.ReactNode) => void;
  /** Add-node callback wired through to keyboard shortcuts and node creation. */
  onAddNode: (type: string) => void;
  /** Tool-panel API lifted to the parent so the sidebar can be rendered up there. */
  toolPanel: ToolPanelApi;
  /** When set, edit-live mode is active and decorations apply to the canvas. */
  liveRunId?: string | null;
  /** Per-node-id execution status, updated live via SSE. Empty when not edit-live. */
  liveStatusByNodeId?: Map<string, NodeExecutionStatus>;
}

export function FlowWorkbenchView({
  flowId,
  // basePath kept on the prop signature for symmetry with FlowEditor; not consumed here yet.
  basePath: _basePath = '',
  onRegisterAddNode,
  onLayoutSelectorRender,
  onAddNode: _onAddNode,
  toolPanel,
  liveRunId = null,
  liveStatusByNodeId,
}: FlowWorkbenchViewProps) {
  const { resolvedTheme } = useTheme();

  // === Zustand store: Fine-grained selectors ===
  const storeNodes = useFlowEditorStore((s) => s.nodes);
  const storeEdges = useFlowEditorStore((s) => s.edges);
  const edgesReady = useFlowEditorStore((s) => s.edgesReady);
  const currentLayout = useFlowEditorStore((s) => s.currentLayout);
  const currentDirection = useFlowEditorStore((s) => s.layoutDirection);
  const configNodeId = useFlowEditorStore((s) => s.selectedNodeId);
  const configPanelOpen = useFlowEditorStore((s) => s.configPanelOpen);

  // Actions
  const onNodesChange = useFlowEditorStore((s) => s.applyNodeChanges);
  const onEdgesChange = useFlowEditorStore((s) => s.applyEdgeChanges);
  const onConnect = useFlowEditorStore((s) => s.onConnect);
  const setLayout = useFlowEditorStore((s) => s.setLayout);
  const setLayoutedNodes = useFlowEditorStore((s) => s.setLayoutedNodes);
  const closeConfigPanel = useFlowEditorStore((s) => s.closeConfigPanel);
  const selectNode = useFlowEditorStore((s) => s.selectNode);
  const openConfigPanel = useFlowEditorStore((s) => s.openConfigPanel);
  const setConfigPanelToolInstanceId = useFlowEditorStore((s) => s.setConfigPanelToolInstanceId);
  const setRegistryLoading = useFlowEditorStore((s) => s.setRegistryLoading);
  const setNodesInitialized = useFlowEditorStore((s) => s.setNodesInitialized);
  const setAllNodesHaveDefinitions = useFlowEditorStore((s) => s.setAllNodesHaveDefinitions);

  const { getNodeDefinition, isLoading: registryLoading } = useNodeRegistry();
  const reactFlowInstance = useReactFlow();
  const { fitView } = reactFlowInstance;

  // --- Extracted hooks ---
  const createNewNode = useNodeCreation();
  useRunDataFromQueryParams();
  useCopyPaste({ flowId, reactFlowInstance });

  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    commandPaletteActions,
  } = useKeyboardShortcuts();

  // Sync React Flow / registry state to Zustand for edge readiness tracking
  const nodesInitializedFromHook = useNodesInitialized();

  const allNodesHaveDefinitions = useMemo(() => {
    if (storeNodes.length === 0) {
      return false;
    }
    return storeNodes.every((node) => {
      const nodeType = (node.data as { type?: string })?.type;
      return nodeType && getNodeDefinition(nodeType);
    });
  }, [storeNodes, getNodeDefinition]);

  React.useEffect(() => {
    setRegistryLoading(registryLoading);
  }, [registryLoading, setRegistryLoading]);

  React.useEffect(() => {
    setNodesInitialized(nodesInitializedFromHook);
  }, [nodesInitializedFromHook, setNodesInitialized]);

  React.useEffect(() => {
    setAllNodesHaveDefinitions(allNodesHaveDefinitions);
  }, [allNodesHaveDefinitions, setAllNodesHaveDefinitions]);

  // --- Interaction refs ---
  const dialogContainerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingNodeRef = useRef(false);
  const isShiftKeyHeldRef = useRef(false);
  const dragEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track shift key state to prevent config panel opening during drag selection
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftKeyHeldRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftKeyHeldRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Only pass edges to React Flow after edgesReady
  const edges = edgesReady ? storeEdges : [];

  // Decorated nodes — merge live execution status onto the editable store nodes
  // when ?runId= is present. The store stays the user's edit state; decoration
  // is render-only.
  const renderedNodes = useMemo(() => {
    if (!liveRunId || !liveStatusByNodeId || liveStatusByNodeId.size === 0) {
      return storeNodes;
    }
    return storeNodes.map((node) => {
      const status = liveStatusByNodeId.get(node.id);
      if (!status) {
        return node;
      }
      return {
        ...node,
        data: { ...(node.data as Record<string, unknown>), executionStatus: status },
      };
    });
  }, [liveRunId, liveStatusByNodeId, storeNodes]);

  // --- Layout ---
  const handleLayoutChange = useCallback(
    async (algorithm: LayoutAlgorithm, direction: 'TB' | 'BT' | 'LR' | 'RL' = 'LR') => {
      setLayout(algorithm, direction);
      const { nodes: currentNodes, edges: currentEdges } = useFlowEditorStore.getState();

      // If 2+ nodes are selected, realign only that subset and preserve its
      // centroid so the rest of the graph stays put.
      const selectedIds = new Set(currentNodes.filter((n) => n.selected).map((n) => n.id));
      if (selectedIds.size >= 2) {
        const selectedNodes = currentNodes.filter((n) => selectedIds.has(n.id));
        const subEdges = currentEdges.filter(
          (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
        );

        const centroid = (nodes: Node[]) => {
          const sum = nodes.reduce(
            (acc, n) => ({ x: acc.x + n.position.x, y: acc.y + n.position.y }),
            { x: 0, y: 0 },
          );
          return { x: sum.x / nodes.length, y: sum.y / nodes.length };
        };

        const before = centroid(selectedNodes);
        const { nodes: laidOut } = await applyLayout(selectedNodes, subEdges, algorithm, direction);
        const after = centroid(laidOut);
        const dx = before.x - after.x;
        const dy = before.y - after.y;

        const translatedById = new Map(
          laidOut.map((n) => [
            n.id,
            { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } },
          ]),
        );
        const merged = currentNodes.map((n) => translatedById.get(n.id) ?? n);
        setLayoutedNodes(merged);
        return;
      }

      const { nodes: layoutedNodes } = await applyLayout(
        currentNodes,
        currentEdges,
        algorithm,
        direction,
      );
      setLayoutedNodes(layoutedNodes);
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 200 });
      }, 50);
    },
    [setLayout, setLayoutedNodes, fitView],
  );

  const handleReactFlowInit = useCallback(() => {
    const currentNodes = useFlowEditorStore.getState().nodes;
    if (currentNodes.length > 0) {
      const hasValidPositions = currentNodes.some(
        (node) => node.position.x !== 0 || node.position.y !== 0,
      );
      if (hasValidPositions) {
        fitView({ padding: 0.2, duration: 0 });
      } else {
        setTimeout(() => {
          fitView({ padding: 0.2, duration: 0 });
        }, 100);
      }
    }
  }, [fitView]);

  // --- Node interaction callbacks ---
  React.useEffect(() => {
    if (configNodeId && !storeNodes.some((candidate) => candidate.id === configNodeId)) {
      closeConfigPanel();
      selectNode(null);
    }
  }, [configNodeId, storeNodes, closeConfigPanel, selectNode]);

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, clickedNode: Node) => {
      if (isDraggingNodeRef.current || isShiftKeyHeldRef.current) {
        return;
      }
      setConfigPanelToolInstanceId(null);
      openConfigPanel(clickedNode.id);
    },
    [openConfigPanel, setConfigPanelToolInstanceId],
  );

  const handleSelectionChange = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onSelectionChange']>
  >(
    ({ nodes: selectedNodes }) => {
      if (isDraggingNodeRef.current || isShiftKeyHeldRef.current) {
        return;
      }
      if (selectedNodes.length === 0) {
        closeConfigPanel();
        selectNode(null);
      }
    },
    [closeConfigPanel, selectNode],
  );

  const handlePanelOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeConfigPanel();
        selectNode(null);
        setConfigPanelToolInstanceId(null);
      }
    },
    [closeConfigPanel, selectNode, setConfigPanelToolInstanceId],
  );

  const handleNodeDragStart = useCallback(() => {
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
      dragEndTimeoutRef.current = null;
    }
    isDraggingNodeRef.current = true;
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    // Only treat as a drop target if a palette node-type is being dragged.
    // React Flow's own node drags don't set dataTransfer types, so this is safe.
    if (event.dataTransfer.types.includes('application/flowlib-node-type')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const type =
        event.dataTransfer.getData('application/flowlib-node-type') ||
        event.dataTransfer.getData('text/plain');
      if (!type) {
        return;
      }
      event.preventDefault();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      createNewNode(type, { position });
    },
    [reactFlowInstance, createNewNode],
  );

  const handleNodeDragStop = useCallback(() => {
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
    }
    dragEndTimeoutRef.current = setTimeout(() => {
      isDraggingNodeRef.current = false;
      dragEndTimeoutRef.current = null;
    }, 150);
  }, []);

  React.useEffect(() => {
    return () => {
      if (dragEndTimeoutRef.current) {
        clearTimeout(dragEndTimeoutRef.current);
        dragEndTimeoutRef.current = null;
      }
    };
  }, []);

  // --- Register addNode + layout selector ---
  React.useEffect(() => {
    if (onRegisterAddNode) {
      onRegisterAddNode(createNewNode);
    }
  }, [onRegisterAddNode, createNewNode]);

  React.useEffect(() => {
    if (onLayoutSelectorRender) {
      onLayoutSelectorRender(
        <LayoutSelector onRealign={() => handleLayoutChange(currentLayout, currentDirection)} />,
      );
    }
  }, [currentLayout, currentDirection, handleLayoutChange, onLayoutSelectorRender]);

  // --- Node types ---
  const { nodeDefinitions } = useNodeRegistry();
  const nodeTypes: NodeTypes = useMemo(() => {
    // @ts-ignore React 19 vs 18 type mismatch in @xyflow/react
    // eslint-disable-next-line typescript/no-explicit-any -- React node components require generic any props
    const mapping: Record<string, React.ComponentType<any>> = {
      'core.agent': AgentNode,
      default: UniversalNode,
    };
    for (const def of nodeDefinitions) {
      if (!(def.type in mapping)) {
        mapping[def.type] = getNodeComponent(def.type);
      }
    }
    return mapping;
  }, [nodeDefinitions]);

  // --- Render ---
  return (
    <>
      <div
        style={{ width: '100%', height: '100%', background: 'var(--canvas-background)' }}
        ref={dialogContainerRef}
      >
        <AgentToolCallbacksProvider value={toolPanel.agentToolCallbacks}>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={handleNodeDoubleClick}
            onSelectionChange={handleSelectionChange}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            nodeTypes={nodeTypes}
            edgeTypes={EDGE_TYPES}
            defaultEdgeOptions={defaultEdgeOptions}
            colorMode={resolvedTheme}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            onInit={handleReactFlowInit}
            panOnDrag={[1, 2]}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnScroll
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          </ReactFlow>
        </AgentToolCallbacksProvider>
      </div>
      <NodeConfigPanel
        open={configPanelOpen}
        nodeId={configNodeId}
        flowId={flowId}
        onOpenChange={handlePanelOpenChange}
        portalContainer={dialogContainerRef.current}
        availableTools={toolPanel.availableTools}
        initialToolInstanceId={toolPanel.configPanelToolInstanceId}
      />
      <FlowCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        actions={commandPaletteActions}
      />
      <ShortcutsHelpDialog open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
    </>
  );
}
