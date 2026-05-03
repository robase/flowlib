import React, { useRef, useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { FlowLayout } from './FlowLayout';
import { ModeSwitcher } from './ModeSwitcher';
import { RunControls } from './RunControls';
import { NodeSidebar } from './NodeSidebar';
import { ValidationPanel } from './ValidationPanel';
import { LayoutSelector } from '../graph/LayoutSelector';
import { BatchFlowEdge, defaultEdgeOptions } from '../graph';
import { applyLayout, type LayoutAlgorithm } from '~/utils/layoutUtils';
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
import { UniversalNode, AgentNode } from '../nodes';
import { getNodeComponent } from '../nodes/nodeRegistry';
import { NodeConfigPanel } from './node-config-panel/NodeConfigPanel';
import { ToolConfigPanel } from './ToolConfigPanel';
import { ChatPanel, ChatToggleButton, ChatPromptOverlay } from '~/components/chat';
import { ViewCodeToggleButton } from './ViewCodeToggleButton';
import { FlowCodePanel } from './FlowCodePanel';
import { useNodeRegistry } from '~/contexts/NodeRegistryContext';
import { useFlowEditorStore } from './flow-editor.store';
import { useFlowReactFlowData } from '../../api/flows.api';
import { useFlowActions } from '../../routes/flow-route-layout';
import { useUIStore } from '~/stores/uiStore';
import { useTheme } from '~/contexts/ThemeProvider';
import { AgentToolCallbacksProvider } from '~/contexts/AgentToolCallbacksContext';
import { Skeleton } from '../ui/skeleton';
import { useCopyPaste } from './use-copy-paste';
import { useKeyboardShortcuts } from './use-keyboard-shortcuts';
import { FlowCommandPalette } from './FlowCommandPalette';
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog';
import { useToolPanel } from './use-tool-panel';
import { useNodeCreation } from './use-node-creation';
import { useRunDataFromQueryParams } from './use-run-data-from-query-params';

// Stable references for React Flow - defined at module scope to avoid re-renders
const EDGE_TYPES: EdgeTypes = {
  default: BatchFlowEdge,
};

const FIT_VIEW_OPTIONS = {
  duration: 0,
  padding: 0.2,
} as const;

export interface FlowEditorProps {
  flowId: string;
  flowVersion?: string;
  basePath?: string;
  initialName?: string;
}

// Edit view shell - displays the flow editor
export function FlowEditor({ flowId, flowVersion, basePath = '' }: FlowEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const addNodeFnRef = useRef<(type: string) => void>(() => {
    // Default implementation
  });
  const [showValidation] = useState(false);
  const [layoutSelector, setLayoutSelector] = useState<React.ReactNode>(null);

  const { isLoading: loading, error: queryError } = useFlowReactFlowData(flowId, {
    version: flowVersion,
  });

  // Sidebar visibility (persisted)
  const nodeSidebarOpen = useUIStore((s) => s.nodeSidebarOpen);
  const toggleNodeSidebar = useUIStore((s) => s.toggleNodeSidebar);

  // Flow actions from parent layout context (execute, active state)
  const flowActions = useFlowActions();

  const handleModeChange = (newMode: 'edit' | 'runs') => {
    if (newMode === 'runs') {
      const runsPath = flowVersion
        ? `${basePath}/flow/${flowId}/runs/version/${flowVersion}`
        : `${basePath}/flow/${flowId}/runs`;
      navigate(runsPath);
    }
  };

  const handleRegisterAddNode = useCallback((fn: (type: string) => void) => {
    addNodeFnRef.current = fn;
  }, []);

  const handleAddNode = useCallback((type: string) => {
    addNodeFnRef.current(type);
  }, []);

  // Sidebar & right panel render state (lifted from FlowWorkbenchView)
  const [sidebarElement, setSidebarElement] = useState<React.ReactNode>(null);
  const [rightPanelElement, setRightPanelElement] = useState<React.ReactNode>(null);

  if (loading) {
    return (
      <div className="flex w-full h-full min-h-0">
        {/* Sidebar skeleton */}
        <div className="flex flex-col w-96 border-r border-border bg-fl-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-7 w-7" />
          </div>
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="flex-1 p-3 space-y-4">
            {Array.from({ length: 3 }).map((_, groupIdx) => (
              <div key={groupIdx} className="space-y-2">
                <Skeleton className="h-3 w-24 mb-2" />
                {Array.from({ length: 4 }).map((_, itemIdx) => (
                  <div key={itemIdx} className="flex items-center gap-2 px-2 py-1.5">
                    <Skeleton className="h-6 w-6 rounded shrink-0" />
                    <Skeleton className="h-3 flex-1 max-w-40" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* Canvas skeleton */}
        <div className="flex-1 relative bg-background">
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-8" />
          </div>
          {/* Faux node placeholders */}
          <div className="absolute left-1/4 top-1/3">
            <Skeleton className="h-20 w-48 rounded-lg" />
          </div>
          <div className="absolute left-1/2 top-1/2">
            <Skeleton className="h-20 w-48 rounded-lg" />
          </div>
          <div className="absolute right-1/4 bottom-1/3">
            <Skeleton className="h-20 w-48 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="p-4 text-red-800 border border-red-200 rounded bg-red-50">
          Error: {queryError.message}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex flex-col flex-1 min-h-0 bg-background text-foreground">
        <FlowLayout
          modeSwitcher={<ModeSwitcher mode="edit" onModeChange={handleModeChange} />}
          layoutSelector={layoutSelector}
          viewportRef={viewportRef}
          sidebar={
            sidebarElement ?? (
              <NodeSidebar mode="nodes" onAddNode={handleAddNode} onCollapse={toggleNodeSidebar} />
            )
          }
          sidebarOpen={nodeSidebarOpen}
          onToggleSidebar={toggleNodeSidebar}
          rightPanel={rightPanelElement}
          chatToggle={<ChatToggleButton />}
          viewCodeToggle={<ViewCodeToggleButton />}
          chatPanel={<ChatPanel flowId={flowId} basePath={basePath} />}
          codePanel={<FlowCodePanel flowId={flowId} />}
          chatOverlay={<ChatPromptOverlay />}
          toolbarExtra={
            <RunControls
              onExecute={flowActions?.onExecute}
              isExecuting={flowActions?.isExecuting}
              isActive={flowActions?.isActive}
              isTogglingActive={flowActions?.isTogglingActive}
              onToggleActive={flowActions?.onToggleActive}
            />
          }
          viewport={
            <FlowWorkbenchView
              flowId={flowId}
              onRegisterAddNode={handleRegisterAddNode}
              onLayoutSelectorRender={setLayoutSelector}
              onAddNode={handleAddNode}
              onSidebarRender={setSidebarElement}
              onRightPanelRender={setRightPanelElement}
            />
          }
        />
      </div>

      {/* Validation panel slides in from right */}
      {showValidation && <ValidationPanel />}
    </div>
  );
}

interface FlowWorkbenchViewProps {
  flowId: string;
  onRegisterAddNode?: (fn: (type: string) => void) => void;
  onLayoutSelectorRender?: (layoutSelector: React.ReactNode) => void;
  /** Callback to add a node (passed from shell, used for sidebar) */
  onAddNode: (type: string) => void;
  /** Renders the sidebar element (NodeSidebar with current mode + props) */
  onSidebarRender: (sidebar: React.ReactNode) => void;
  /** Renders the right panel element (ToolConfigPanel when active) */
  onRightPanelRender: (rightPanel: React.ReactNode | null) => void;
}

export function FlowWorkbenchView({
  flowId,
  onRegisterAddNode,
  onLayoutSelectorRender,
  onAddNode,
  onSidebarRender,
  onRightPanelRender,
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
  const setRegistryLoading = useFlowEditorStore((s) => s.setRegistryLoading);
  const setNodesInitialized = useFlowEditorStore((s) => s.setNodesInitialized);
  const setAllNodesHaveDefinitions = useFlowEditorStore((s) => s.setAllNodesHaveDefinitions);

  const { getNodeDefinition, isLoading: registryLoading } = useNodeRegistry();
  const reactFlowInstance = useReactFlow();
  const { fitView } = reactFlowInstance;

  // --- Extracted hooks ---
  const toolPanel = useToolPanel();
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
      toolPanel.setConfigPanelToolInstanceId(null);
      toolPanel.openConfigPanel(clickedNode.id);
    },
    [toolPanel.openConfigPanel],
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
        toolPanel.setConfigPanelToolInstanceId(null);
      }
    },
    [closeConfigPanel, selectNode],
  );

  const handleNodeDragStart = useCallback(() => {
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
      dragEndTimeoutRef.current = null;
    }
    isDraggingNodeRef.current = true;
  }, []);

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

  // --- Push sidebar/right panel to shell ---
  const toggleNodeSidebar = useUIStore((s) => s.toggleNodeSidebar);

  React.useEffect(() => {
    onSidebarRender(
      <NodeSidebar
        mode={toolPanel.sidebarMode}
        onAddNode={onAddNode}
        onCollapse={toggleNodeSidebar}
        onClose={
          toolPanel.sidebarMode === 'actions' ? toolPanel.handleCloseToolSelector : undefined
        }
        availableTools={toolPanel.availableTools}
        addedTools={toolPanel.currentNodeAddedTools}
        onAddTool={toolPanel.handleAddToolToNode}
        onRemoveTool={toolPanel.handleRemoveToolFromNode}
        onSelectTool={toolPanel.handleSelectToolInstance}
        selectedInstanceId={toolPanel.selectedToolInstanceId}
      />,
    );
  }, [
    toolPanel.sidebarMode,
    onAddNode,
    toggleNodeSidebar,
    toolPanel.handleCloseToolSelector,
    toolPanel.availableTools,
    toolPanel.currentNodeAddedTools,
    toolPanel.handleAddToolToNode,
    toolPanel.handleRemoveToolFromNode,
    toolPanel.handleSelectToolInstance,
    toolPanel.selectedToolInstanceId,
    onSidebarRender,
  ]);

  React.useEffect(() => {
    if (
      toolPanel.toolConfigPanelOpen &&
      toolPanel.selectedToolDef &&
      toolPanel.selectedToolInstance
    ) {
      onRightPanelRender(
        <ToolConfigPanel
          open={toolPanel.toolConfigPanelOpen}
          onClose={toolPanel.handleCloseToolConfig}
          tool={toolPanel.selectedToolDef}
          instance={toolPanel.selectedToolInstance}
          onUpdate={toolPanel.handleUpdateToolInNode}
          onRemove={toolPanel.handleRemoveToolFromNode}
          portalContainer={dialogContainerRef.current}
        />,
      );
    } else {
      onRightPanelRender(null);
    }
  }, [
    toolPanel.toolConfigPanelOpen,
    toolPanel.selectedToolDef,
    toolPanel.selectedToolInstance,
    toolPanel.handleCloseToolConfig,
    toolPanel.handleUpdateToolInNode,
    toolPanel.handleRemoveToolFromNode,
    onRightPanelRender,
  ]);

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
            nodes={storeNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={handleNodeDoubleClick}
            onSelectionChange={handleSelectionChange}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
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
