import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges, addEdge, type Connection } from '@xyflow/react';
import type { LayoutAlgorithm } from '~/utils/layoutUtils';
import type { ReactFlowNodeData } from '@flowlib/core/types';
import { computeSnapshot } from '~/utils/flowTransformations';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

// Re-export for convenience
export type { LayoutAlgorithm } from '~/utils/layoutUtils';

// Type alias for flow nodes with proper data typing
// We use Node<ReactFlowNodeData> for type safety while maintaining React Flow compatibility
export type FlowNode = Node<ReactFlowNodeData>;

// Helper type guard to check if a node has properly typed data
export function isFlowNode(node: Node): node is FlowNode {
  const data = node.data as Record<string, unknown>;
  return (
    typeof data?.id === 'string' &&
    typeof data?.type === 'string' &&
    typeof data?.display_name === 'string' &&
    typeof data?.reference_id === 'string'
  );
}

// Helper to safely get typed node data
export function getNodeData(node: Node): ReactFlowNodeData | null {
  if (isFlowNode(node)) {
    return node.data;
  }
  return null;
}

export interface FlowEditorState {
  // Flow identity
  flowId: string | null;
  flowVersion: string | null;

  // Local working copy (derived from React Query, modified locally)
  // Using Node[] for React Flow compatibility, but data should be ReactFlowNodeData
  nodes: Node[];
  edges: Edge[];

  // Edge rendering control - prevents "Couldn't create edge for source handle" errors
  // Edges are only rendered when this is true (after nodes + definitions are ready)
  edgesReady: boolean;

  // Node initialization tracking for edge readiness
  registryLoading: boolean;
  nodesInitialized: boolean; // From React Flow's useNodesInitialized
  allNodesHaveDefinitions: boolean;
  nodesReinitializedAfterRegistry: boolean;
  definitionsLoadedTime: number | null;

  // Dirty tracking (content-based)
  // currentSnapshot: serialized FlowlibDefinition from the latest structural mutation
  // lastSavedSnapshot: serialized FlowlibDefinition from the last save or server sync
  // isDirty is derived: currentSnapshot !== lastSavedSnapshot
  currentSnapshot: string | null;
  lastSavedSnapshot: string | null;
  lastSavedVersionId: string | null;
  initialDataLoaded: boolean;

  // Selection state
  selectedNodeId: string | null;
  configPanelOpen: boolean;

  // Tool panel state (Agent nodes)
  toolSelectorOpen: boolean;
  toolConfigOpen: boolean;
  toolPanelNodeId: string | null;
  selectedToolInstanceId: string | null;
  configPanelToolInstanceId: string | null;

  // Layout state
  currentLayout: LayoutAlgorithm;
  layoutDirection: LayoutDirection;

  // Execution tracking - for showing running state in editor
  activeFlowRunId: string | null;
}

export interface FlowEditorActions {
  // Flow identity
  setFlowId: (flowId: string | null, version?: string | null) => void;

  // Node operations
  setNodes: (nodes: Node[]) => void;
  applyNodeChanges: (changes: NodeChange[]) => void;
  updateNodeData: (nodeId: string, data: Partial<ReactFlowNodeData>) => void;
  addNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  removeNodes: (nodeIds: string[]) => void;

  // Batch operations
  pasteNodesAndEdges: (newNodes: Node[], newEdges: Edge[]) => void;

  // Edge operations
  setEdges: (edges: Edge[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;
  addEdge: (edge: Edge) => void;
  onConnect: (connection: Connection) => void;
  removeEdge: (edgeId: string) => void;
  removeEdgesBySourceHandle: (nodeId: string, handleId: string) => void;
  setEdgesReady: (ready: boolean) => void;

  // Edge readiness tracking
  setRegistryLoading: (loading: boolean) => void;
  setNodesInitialized: (initialized: boolean) => void;
  setAllNodesHaveDefinitions: (hasDefinitions: boolean) => void;
  checkAndUpdateEdgesReady: () => void;

  // Selection
  selectNode: (nodeId: string | null) => void;
  openConfigPanel: (nodeId: string) => void;
  closeConfigPanel: () => void;

  // Tool panel (Agent nodes)
  openToolSelector: (nodeId: string) => void;
  closeToolSelector: () => void;
  openToolConfig: (nodeId: string, instanceId: string) => void;
  closeToolConfig: () => void;
  setConfigPanelToolInstanceId: (id: string | null) => void;

  // Sync with server data
  syncFromServer: (nodes: Node[], edges: Edge[], versionId: string) => void;
  markSaved: (versionId: string) => void;
  markDirty: () => void;
  resetDirty: (savedVersionId?: string) => void;

  // Layout
  setLayout: (layout: LayoutAlgorithm, direction?: LayoutDirection) => void;
  setLayoutedNodes: (nodes: Node[]) => void;

  // Execution tracking
  setActiveFlowRunId: (flowRunId: string | null) => void;
  updateNodeExecutionStatus: (
    nodeId: string,
    status: string,
    output?: unknown,
    error?: string,
  ) => void;
  clearAllExecutionStatus: () => void;

  // Run data population (from runs view "Edit" button)
  populateFromRunData: (
    nodeExecutionMap: Record<string, { inputs?: unknown; outputs?: unknown }>,
  ) => void;

  // Reset
  reset: () => void;
}

export type FlowEditorStore = FlowEditorState & FlowEditorActions;

const initialState: FlowEditorState = {
  flowId: null,
  flowVersion: null,
  nodes: [],
  edges: [],
  edgesReady: false,
  registryLoading: true,
  nodesInitialized: false,
  allNodesHaveDefinitions: false,
  nodesReinitializedAfterRegistry: false,
  definitionsLoadedTime: null,
  currentSnapshot: null,
  lastSavedSnapshot: null,
  lastSavedVersionId: null,
  initialDataLoaded: false,
  selectedNodeId: null,
  configPanelOpen: false,
  toolSelectorOpen: false,
  toolConfigOpen: false,
  toolPanelNodeId: null,
  selectedToolInstanceId: null,
  configPanelToolInstanceId: null,
  currentLayout: 'elkjs',
  layoutDirection: 'LR',
  activeFlowRunId: null,
};

// Explicit type annotation for Zustand store to prevent immer inference issues
export const useFlowEditorStore: UseBoundStore<StoreApi<FlowEditorStore>> =
  create<FlowEditorStore>()(
    devtools(
      subscribeWithSelector(
        immer((set, _get) => ({
          ...initialState,

          // Flow identity
          setFlowId: (flowId, version = null) =>
            set((state) => {
              // Reset state when changing flows
              if (state.flowId !== flowId) {
                return { ...initialState, flowId, flowVersion: version };
              }
              state.flowId = flowId;
              state.flowVersion = version;
            }),

          // Node operations
          setNodes: (nodes) =>
            set((state) => {
              state.nodes = nodes;
              if (state.initialDataLoaded) {
                state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              }
            }),

          applyNodeChanges: (changes) =>
            set((state) => {
              state.nodes = applyNodeChanges(changes, state.nodes) as Node[];
              if (state.initialDataLoaded) {
                // Only recompute snapshot for structural changes (not select/dimensions)
                const hasStructural = changes.some(
                  (c) => c.type !== 'select' && c.type !== 'dimensions',
                );
                if (hasStructural) {
                  state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
                }
              }
            }),

          updateNodeData: (nodeId, data) =>
            set((state) => {
              const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
              if (nodeIndex !== -1) {
                state.nodes[nodeIndex] = {
                  ...state.nodes[nodeIndex],
                  data: { ...state.nodes[nodeIndex].data, ...data },
                };
                state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              }
            }),

          addNode: (node) =>
            set((state) => {
              state.nodes.push(node);
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
            }),

          removeNode: (nodeId) =>
            set((state) => {
              state.nodes = state.nodes.filter((n) => n.id !== nodeId);
              // Also remove connected edges
              state.edges = state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              if (state.selectedNodeId === nodeId) {
                state.selectedNodeId = null;
                state.configPanelOpen = false;
              }
            }),

          removeNodes: (nodeIds) =>
            set((state) => {
              const idSet = new Set(nodeIds);
              state.nodes = state.nodes.filter((n) => !idSet.has(n.id));
              state.edges = state.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              if (state.selectedNodeId && idSet.has(state.selectedNodeId)) {
                state.selectedNodeId = null;
                state.configPanelOpen = false;
              }
            }),

          pasteNodesAndEdges: (newNodes, newEdges) =>
            set((state) => {
              // Deselect all existing nodes
              state.nodes = state.nodes.map((n) => ({ ...n, selected: false }));
              // Add new nodes (already marked selected: true by caller)
              state.nodes.push(...newNodes);
              // Add new edges
              state.edges.push(...newEdges);
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              state.selectedNodeId = null;
              state.configPanelOpen = false;
            }),

          // Edge operations
          setEdges: (edges) =>
            set((state) => {
              state.edges = edges;
              if (state.initialDataLoaded) {
                state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              }
            }),

          applyEdgeChanges: (changes) =>
            set((state) => {
              state.edges = applyEdgeChanges(changes, state.edges) as Edge[];
              if (state.initialDataLoaded) {
                // Only recompute for structural changes (not select)
                const hasStructural = changes.some((c) => c.type !== 'select');
                if (hasStructural) {
                  state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
                }
              }
            }),

          addEdge: (edge) =>
            set((state) => {
              state.edges.push(edge);
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
            }),

          onConnect: (connection) =>
            set((state) => {
              state.edges = addEdge(connection, state.edges);
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
            }),

          removeEdge: (edgeId) =>
            set((state) => {
              state.edges = state.edges.filter((e) => e.id !== edgeId);
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
            }),

          removeEdgesBySourceHandle: (nodeId: string, handleId: string) =>
            set((state) => {
              state.edges = state.edges.filter(
                (e) => !(e.source === nodeId && e.sourceHandle === handleId),
              );
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
            }),

          setEdgesReady: (ready) =>
            set((state) => {
              state.edgesReady = ready;
            }),

          // Edge readiness tracking
          setRegistryLoading: (loading) =>
            set((state) => {
              state.registryLoading = loading;
              // When registry finishes loading, check edge readiness
              if (!loading) {
                // Will be checked via checkAndUpdateEdgesReady
              }
            }),

          setNodesInitialized: (initialized) =>
            set((state) => {
              state.nodesInitialized = initialized;
            }),

          setAllNodesHaveDefinitions: (hasDefinitions) => {
            const prevHadDefinitions = _get().allNodesHaveDefinitions;
            set((state) => {
              state.allNodesHaveDefinitions = hasDefinitions;

              // When definitions become available, record the time and reset reinit flag
              if (hasDefinitions && !prevHadDefinitions) {
                state.definitionsLoadedTime = Date.now();
                state.nodesReinitializedAfterRegistry = false;
              }
            });

            // Schedule re-init confirmation after delay for handles to mount
            // (kept outside set() to avoid side effects inside immer drafts)
            if (hasDefinitions && !prevHadDefinitions) {
              const MINIMUM_DELAY = 250;
              setTimeout(() => {
                const currentState = _get();
                if (
                  currentState.allNodesHaveDefinitions &&
                  !currentState.nodesReinitializedAfterRegistry
                ) {
                  set((s) => {
                    s.nodesReinitializedAfterRegistry = true;
                  });
                }
              }, MINIMUM_DELAY);
            }
          },

          checkAndUpdateEdgesReady: () =>
            set((state) => {
              const shouldBeReady =
                !state.registryLoading &&
                state.nodes.length > 0 &&
                state.nodesInitialized &&
                state.allNodesHaveDefinitions &&
                state.nodesReinitializedAfterRegistry;

              if (shouldBeReady !== state.edgesReady) {
                state.edgesReady = shouldBeReady;
              }
            }),

          // Selection
          selectNode: (nodeId) =>
            set((state) => {
              state.selectedNodeId = nodeId;
            }),

          openConfigPanel: (nodeId) =>
            set((state) => {
              state.selectedNodeId = nodeId;
              state.configPanelOpen = true;
            }),

          closeConfigPanel: () =>
            set((state) => {
              state.configPanelOpen = false;
            }),

          // Tool panel (Agent nodes)
          openToolSelector: (nodeId) =>
            set((state) => {
              state.toolSelectorOpen = true;
              state.toolPanelNodeId = nodeId;
            }),

          closeToolSelector: () =>
            set((state) => {
              state.toolSelectorOpen = false;
              state.toolConfigOpen = false;
              state.selectedToolInstanceId = null;
              state.toolPanelNodeId = null;
            }),

          openToolConfig: (nodeId, instanceId) =>
            set((state) => {
              state.toolPanelNodeId = nodeId;
              state.selectedToolInstanceId = instanceId;
              state.toolConfigOpen = true;
            }),

          closeToolConfig: () =>
            set((state) => {
              state.toolConfigOpen = false;
              state.selectedToolInstanceId = null;
            }),

          setConfigPanelToolInstanceId: (id) =>
            set((state) => {
              state.configPanelToolInstanceId = id;
            }),

          // Sync with server data - called when React Query fetches new data
          syncFromServer: (nodes, edges, versionId) =>
            set((state) => {
              const incomingSnapshot = computeSnapshot(nodes, edges);

              // Only sync if:
              // 1. We haven't loaded initial data yet
              // 2. OR this is a different version than what we have AND we haven't diverged
              //    (content-based: current snapshot still matches last saved = no local changes)
              const isDirty =
                state.currentSnapshot !== null && state.currentSnapshot !== state.lastSavedSnapshot;
              const shouldSync =
                !state.initialDataLoaded || (state.lastSavedVersionId !== versionId && !isDirty);

              if (shouldSync) {
                state.nodes = nodes;
                state.edges = edges;
                state.currentSnapshot = incomingSnapshot;
                state.lastSavedSnapshot = incomingSnapshot;
                state.lastSavedVersionId = versionId;
                state.initialDataLoaded = true;
              }
            }),

          markSaved: (versionId) =>
            set((state) => {
              state.lastSavedSnapshot = state.currentSnapshot;
              state.lastSavedVersionId = versionId;
            }),

          markDirty: () =>
            set((state) => {
              if (state.initialDataLoaded) {
                // Force snapshot recomputation (for cases where external code
                // needs to explicitly mark dirty without a structural mutation)
                state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
              }
            }),

          resetDirty: (savedVersionId) =>
            set((state) => {
              // Align snapshots so isDirty becomes false
              state.lastSavedSnapshot = state.currentSnapshot;
              if (savedVersionId) {
                state.lastSavedVersionId = savedVersionId;
              }
            }),

          // Layout
          setLayout: (layout, direction) =>
            set((state) => {
              state.currentLayout = layout;
              if (direction) {
                state.layoutDirection = direction;
              }
            }),

          setLayoutedNodes: (nodes) =>
            set((state) => {
              state.nodes = nodes;
              // Layout changes are saved, so recompute snapshot
              state.currentSnapshot = computeSnapshot(state.nodes, state.edges);
            }),

          // Execution tracking
          setActiveFlowRunId: (flowRunId) =>
            set((state) => {
              state.activeFlowRunId = flowRunId;
            }),

          updateNodeExecutionStatus: (nodeId, status, output, error) =>
            set((state) => {
              const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
              if (nodeIndex !== -1) {
                state.nodes[nodeIndex] = {
                  ...state.nodes[nodeIndex],
                  data: {
                    ...state.nodes[nodeIndex].data,
                    executionStatus: status,
                    ...(output !== undefined && { executionOutput: output }),
                    ...(error !== undefined && { executionError: error }),
                  },
                };
              }
            }),

          clearAllExecutionStatus: () =>
            set((state) => {
              state.nodes = state.nodes.map((node) => ({
                ...node,
                data: {
                  ...node.data,
                  executionStatus: undefined,
                  executionOutput: undefined,
                  executionError: undefined,
                },
              }));
              state.activeFlowRunId = null;
            }),

          // Run data population — fills preview data from a past flow run
          // without marking the flow as dirty (no structural changes).
          populateFromRunData: (nodeExecutionMap) =>
            set((state) => {
              state.nodes = state.nodes.map((node) => {
                const exec = nodeExecutionMap[node.id];
                if (!exec) {
                  return node;
                }
                return {
                  ...node,
                  data: {
                    ...node.data,
                    ...(exec.inputs !== undefined && { previewInput: exec.inputs }),
                    ...(exec.outputs !== undefined && { previewOutput: exec.outputs }),
                  },
                };
              });
            }),

          // Reset
          reset: () => set(() => ({ ...initialState })),
        })),
      ),
      { name: 'flow-editor' },
    ),
  );

// Subscribe to state changes that affect edge readiness
// This automatically calls checkAndUpdateEdgesReady when relevant state changes
const _unsubscribeEdgeReadiness = useFlowEditorStore.subscribe((state, prevState) => {
  const changed =
    state.registryLoading !== prevState.registryLoading ||
    state.nodes.length !== prevState.nodes.length ||
    state.nodesInitialized !== prevState.nodesInitialized ||
    state.allNodesHaveDefinitions !== prevState.allNodesHaveDefinitions ||
    state.nodesReinitializedAfterRegistry !== prevState.nodesReinitializedAfterRegistry;

  if (changed) {
    // Debounce slightly to batch rapid state changes
    setTimeout(() => {
      useFlowEditorStore.getState().checkAndUpdateEdgesReady();
    }, 0);
  }
});

// Selector hooks for performance - components only re-render when their specific slice changes
export const useNodes = () => useFlowEditorStore((s) => s.nodes);
export const useEdges = () => useFlowEditorStore((s) => s.edges);
export const useEdgesReady = () => useFlowEditorStore((s) => s.edgesReady);
export const useIsDirty = () =>
  useFlowEditorStore(
    (s) => s.currentSnapshot !== null && s.currentSnapshot !== s.lastSavedSnapshot,
  );
export const useSelectedNodeId = () => useFlowEditorStore((s) => s.selectedNodeId);
export const useConfigPanelOpen = () => useFlowEditorStore((s) => s.configPanelOpen);
export const useToolSelectorOpen = () => useFlowEditorStore((s) => s.toolSelectorOpen);
export const useToolConfigOpen = () => useFlowEditorStore((s) => s.toolConfigOpen);
export const useToolPanelNodeId = () => useFlowEditorStore((s) => s.toolPanelNodeId);
export const useSelectedToolInstanceId = () => useFlowEditorStore((s) => s.selectedToolInstanceId);
export const useConfigPanelToolInstanceId = () =>
  useFlowEditorStore((s) => s.configPanelToolInstanceId);
export const useCurrentLayout = () => useFlowEditorStore((s) => s.currentLayout);
export const useLayoutDirection = () => useFlowEditorStore((s) => s.layoutDirection);

// Combined selectors for common use cases (useShallow prevents re-renders when
// the returned object is structurally equal)
export const useFlowEditorSelection = () =>
  useFlowEditorStore(
    useShallow((s) => ({
      selectedNodeId: s.selectedNodeId,
      configPanelOpen: s.configPanelOpen,
      selectNode: s.selectNode,
      openConfigPanel: s.openConfigPanel,
      closeConfigPanel: s.closeConfigPanel,
    })),
  );

export const useFlowEditorLayout = () =>
  useFlowEditorStore(
    useShallow((s) => ({
      currentLayout: s.currentLayout,
      layoutDirection: s.layoutDirection,
      setLayout: s.setLayout,
      setLayoutedNodes: s.setLayoutedNodes,
    })),
  );

// Get node by ID
export const useNode = (nodeId: string | null) =>
  useFlowEditorStore((s) => (nodeId ? (s.nodes.find((n) => n.id === nodeId) ?? null) : null));

// Get node metadata for logs/display (safely accesses typed data)
export const useNodeMetadata = () =>
  useFlowEditorStore((s) =>
    s.nodes.reduce<Record<string, { name: string; type?: string }>>((acc, node) => {
      const data = getNodeData(node);
      acc[node.id] = {
        name: data?.display_name ?? node.id,
        type: node.type,
      };
      return acc;
    }, {}),
  );

// Get incoming edges for a node (edges where this node is the target)
export const useIncomingEdges = (nodeId: string | null) =>
  useFlowEditorStore((s) => (nodeId ? s.edges.filter((e) => e.target === nodeId) : []));

// Get outgoing edges for a node (edges where this node is the source)
export const useOutgoingEdges = (nodeId: string | null) =>
  useFlowEditorStore((s) => (nodeId ? s.edges.filter((e) => e.source === nodeId) : []));

// Get upstream nodes (nodes connected as sources to this node)
export const useUpstreamNodes = (nodeId: string | null) =>
  useFlowEditorStore((s) => {
    if (!nodeId) {
      return [];
    }
    const incomingEdges = s.edges.filter((e) => e.target === nodeId);
    const sourceIds = new Set(incomingEdges.map((e) => e.source));
    return s.nodes.filter((n) => sourceIds.has(n.id));
  });

// Get downstream nodes (nodes connected as targets from this node)
export const useDownstreamNodes = (nodeId: string | null) =>
  useFlowEditorStore((s) => {
    if (!nodeId) {
      return [];
    }
    const outgoingEdges = s.edges.filter((e) => e.source === nodeId);
    const targetIds = new Set(outgoingEdges.map((e) => e.target));
    return s.nodes.filter((n) => targetIds.has(n.id));
  });

// Get flow statistics
export const useFlowStats = () =>
  useFlowEditorStore(
    useShallow((s) => ({
      nodeCount: s.nodes.length,
      edgeCount: s.edges.length,
      isDirty: s.currentSnapshot !== null && s.currentSnapshot !== s.lastSavedSnapshot,
    })),
  );
