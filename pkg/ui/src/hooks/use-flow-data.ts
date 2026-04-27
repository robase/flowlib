import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { useFlowReactFlowData } from '../api/flows.api';
import { type ReactFlowData } from '@flowlib/core/types';

// Hook that uses the backend React Flow renderer service
export function useFlowData(
  flowId: string,
  flowVersion?: string,
  flowRunId?: string,
): {
  flowData: ReactFlowData | undefined;
  displayVersion: ReactFlowData['version'] | undefined;
  loading: boolean;
  error: string | null;
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  isDirty: boolean;
  resetDirty: (savedVersionId?: string) => void;
  queryError: string | null;
  nodeMetadata: Record<string, { name: string; type?: string }>;
} {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  // Track the last version we loaded to avoid re-applying same data after save
  const lastLoadedVersionRef = useRef<string | null>(null);

  // Use React Query to fetch flow data (backend already provides positioned nodes)
  const {
    data: flowData,
    isLoading: loading,
    error: queryError,
  } = useFlowReactFlowData(flowId, { version: flowVersion, flowRunId });

  // Apply backend data directly when it changes (backend provides positions)
  // But skip if we just saved and the version hasn't actually changed
  useEffect(() => {
    if (!flowData?.nodes) {
      setNodes([]);
      setEdges([]);
      lastLoadedVersionRef.current = null;
      return;
    }

    // Use flowId:version as composite identifier to detect if this is truly new data
    const versionInfo = flowData.version;
    const currentVersionId = versionInfo ? `${versionInfo.flowId}:${versionInfo.version}` : null;

    // When tracking a flow run, always update nodes to show execution status changes
    // Only skip version check when NOT tracking execution
    if (!flowRunId) {
      // Skip if we've already loaded this exact version (prevents panel closing on save)
      if (
        currentVersionId &&
        currentVersionId === lastLoadedVersionRef.current &&
        initialDataLoaded
      ) {
        return;
      }
    }

    // Set nodes and edges from backend (already positioned)
    setNodes(flowData.nodes as Node[]);
    setEdges(flowData.edges as Edge[]);

    // Mark initial data as loaded and track the version
    setInitialDataLoaded(true);
    lastLoadedVersionRef.current = currentVersionId;
  }, [flowData, flowRunId, setNodes, setEdges, initialDataLoaded]);

  // Track local changes (dirty state) - only after initial data is loaded
  useEffect(() => {
    if (initialDataLoaded) {
      setIsDirty(true);
    }
  }, [nodes, edges, initialDataLoaded]);

  // Reset dirty state, optionally marking a newly saved version as already loaded
  const resetDirty = useCallback((savedVersionId?: string) => {
    setIsDirty(false);
    // If we know the new version ID, mark it as loaded so we don't re-apply data on refetch
    if (savedVersionId) {
      lastLoadedVersionRef.current = savedVersionId;
    }
  }, []);

  const nodeMetadata = useMemo(() => {
    if (!flowData?.nodes) {
      return {};
    }

    return flowData.nodes.reduce(
      (acc: Record<string, { name: string; type?: string }>, node: Node) => {
        acc[node.id] = {
          name: ((node.data as Record<string, unknown>)?.display_name as string) || node.id,
          type: node.type,
        };
        return acc;
      },
      {},
    );
  }, [flowData]);

  return {
    // Data
    flowData,
    displayVersion: flowData?.version,

    // Loading states
    loading,
    error: queryError?.message || null,

    // Nodes and edges
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,

    // Dirty state tracking
    isDirty,
    resetDirty,

    queryError: queryError?.message || null,
    nodeMetadata,
  };
}

export type UseFlowDataResult = ReturnType<typeof useFlowData>;
