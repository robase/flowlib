import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ReactFlow,
  type NodeTypes,
  type EdgeTypes,
  Controls,
  Background,
  useReactFlow,
  useNodesInitialized,
  useUpdateNodeInternals,
} from '@xyflow/react';

import { BatchFlowEdge, defaultEdgeOptions } from '../graph';
import { NodeViewProvider, createContextAwareNodes } from '../nodes';
import { getNodeComponent } from '../nodes/nodeRegistry';
import { withNodeContext } from '../nodes/withNodeContext';
import { FlowRunStatus, NodeExecutionStatus, ReactFlowNodeData } from '@flowlib/core/types';
import { FlowRun } from '@flowlib/core/types';
import { Node } from '@xyflow/react';
import { useTheme } from '~/contexts/ThemeProvider';
import { Skeleton } from '../ui/skeleton';

// Import shared hook
import { useFlowData } from '../../hooks/use-flow-data';

// Base node types (enum-based) wrapped with view context
const baseNodeTypes = createContextAwareNodes();

const edgeTypes = {
  // flowlib: BatchFlowEdge,
  default: BatchFlowEdge,
} as EdgeTypes;

interface FlowStatusViewProps {
  flowId: string;
  flowVersion?: string;
  basePath?: string;
  selectedRunId: string | null;
  selectedRun: FlowRun | null | undefined;
  logsExpanded: boolean;
  onNodeClick?: (nodeId: string) => void;
  onEditNode?: (nodeId: string) => void;
  /** Node ID to focus/center on (only set on user-initiated selection) */
  focusNodeId?: string | null;
  /** Callback when focus animation completes */
  onFocusComplete?: () => void;
  /** Incrementing counter that triggers a recenter (e.g. after panel resize) */
  recenterTrigger?: number;
  /** Currently selected node ID in the execution logs (for resize recenter) */
  selectedNodeId?: string | null;
}

export function FlowStatusView({
  flowId,
  flowVersion,
  basePath: _basePath = '',
  selectedRunId,
  selectedRun,
  logsExpanded,
  onNodeClick,
  onEditNode,
  focusNodeId,
  onFocusComplete,
  recenterTrigger,
  selectedNodeId,
}: FlowStatusViewProps) {
  const _navigate = useNavigate();
  const reactFlowInstance = useReactFlow();
  const { resolvedTheme } = useTheme();

  // Get flow data — execution status is streamed via SSE (useFlowRunStream in
  // FlowEditor), so we only need a single fetch of the graph structure here.
  const { flowData, loading, queryError, nodes, onNodesChange, edges, onEdgesChange } = useFlowData(
    flowId,
    flowVersion,
    selectedRunId || undefined,
  );

  // Wait until React Flow has measured all nodes and registered their handles
  // before rendering edges. Output handles use nested relative positioning with
  // CSS transforms, so we add a short delay after nodesInitialized for the
  // browser to compute final handle positions. Without this, edge source points
  // appear slightly disconnected from output handles.
  const nodesInitialized = useNodesInitialized();
  const updateNodeInternals = useUpdateNodeInternals();
  const [edgesReady, setEdgesReady] = useState(false);

  // nodeTypes: AGENT gets a custom component, everything else renders as
  // UniversalNode. Register action types from current flow nodes to avoid
  // ReactFlow's fallback CSS class; "default" catches unknown types.
  // Derive a stable key from the set of unique node types so the memo only
  // recomputes when a genuinely new type appears (not on every node change).
  const nodeTypeKeys = useMemo(() => {
    const types = new Set<string>();
    for (const node of nodes) {
      const nodeType = (node.data as { type?: string })?.type ?? node.type;
      if (nodeType) {
        types.add(nodeType);
      }
    }
    return [...types].sort().join(',');
  }, [nodes]);

  const nodeTypes = useMemo(() => {
    const mapping = { ...baseNodeTypes };
    for (const key of nodeTypeKeys.split(',')) {
      if (key && !(key in mapping)) {
        mapping[key] = withNodeContext(getNodeComponent(key));
      }
    }
    return mapping as NodeTypes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeTypeKeys]);

  // Fit view when logs panel is expanded/collapsed
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      if (typeof reactFlowInstance.fitView === 'function') {
        reactFlowInstance.fitView({ padding: 0.5, maxZoom: 1.2, duration: 200 });
      }
    }, 150);

    return () => clearTimeout(timeout);
  }, [logsExpanded, reactFlowInstance]);

  // Keep refs for values used by the recenter effect so it only fires on recenterTrigger
  const recenterStateRef = useRef({ focusNodeId, selectedNodeId, nodes, reactFlowInstance });
  recenterStateRef.current = { focusNodeId, selectedNodeId, nodes, reactFlowInstance };

  // Recenter after panel resize — center on selected node or fit entire flow
  React.useEffect(() => {
    if (!recenterTrigger) {
      return;
    }

    const {
      focusNodeId: fid,
      selectedNodeId: sid,
      nodes: n,
      reactFlowInstance: rf,
    } = recenterStateRef.current;
    if (!n.length) {
      return;
    }

    const timeout = setTimeout(() => {
      const centerId = fid || sid;
      if (centerId) {
        const targetNode = n.find((node) => node.id === centerId);
        if (targetNode) {
          const nodeWidth = targetNode.measured?.width ?? targetNode.width ?? 200;
          const nodeHeight = targetNode.measured?.height ?? targetNode.height ?? 60;
          const x = targetNode.position.x + nodeWidth / 2;
          const y = targetNode.position.y + nodeHeight / 2;
          rf.setCenter(x, y, { duration: 200, zoom: rf.getZoom() });
          return;
        }
      }
      rf.fitView({ padding: 0.5, maxZoom: 1.2, duration: 200 });
    }, 50);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTrigger]);

  // Center on focused node when user explicitly clicks (not on auto-select)
  useEffect(() => {
    if (!focusNodeId || !nodes.length) {
      return;
    }

    // Find the node in the current nodes array
    const targetNode = nodes.find((n) => n.id === focusNodeId);
    if (!targetNode) {
      return;
    }

    // Use setCenter to pan and zoom to the node's position
    // Adding a small delay to ensure the view has settled
    const timeout = setTimeout(() => {
      const nodeWidth = targetNode.measured?.width ?? targetNode.width ?? 200;
      const nodeHeight = targetNode.measured?.height ?? targetNode.height ?? 60;

      // Center on the node's center point and zoom in
      const x = targetNode.position.x + nodeWidth / 2;
      const y = targetNode.position.y + nodeHeight / 2;

      // Zoom to 1.5x when focusing on a node (or current zoom if already higher)
      const targetZoom = Math.max(1.5, reactFlowInstance.getZoom());
      reactFlowInstance.setCenter(x, y, { duration: 300, zoom: targetZoom });

      // Clear the focus after centering is complete
      if (onFocusComplete) {
        setTimeout(onFocusComplete, 350);
      }
    }, 50);

    return () => clearTimeout(timeout);
  }, [focusNodeId, nodes, reactFlowInstance, onFocusComplete]);

  // Process nodes for batch execution state management
  const processNodesForBatchExecution = (originalNodes: Node[]) => {
    // If there's no execution or execution is not active, return nodes as-is
    if (!selectedRun || !selectedRun.status) {
      return originalNodes;
    }

    const isExecutionActive = [
      FlowRunStatus.RUNNING,
      FlowRunStatus.PENDING,
      FlowRunStatus.PAUSED_FOR_BATCH,
    ].includes(selectedRun.status);

    return originalNodes.map((node) => {
      const processedNode = { ...node };
      const nodeData = node.data as ReactFlowNodeData;

      if (isExecutionActive) {
        // If flow is running via batch, set nodes to appropriate states
        if (!nodeData.executionStatus) {
          // Node hasn't been executed yet - set to waiting
          processedNode.data = {
            ...node.data,
            executionStatus: NodeExecutionStatus.PENDING,
          };
        } else if (nodeData.executionStatus === NodeExecutionStatus.BATCH_SUBMITTED) {
          // Node is in batch processing - show as running
          processedNode.data = {
            ...node.data,
            executionStatus: NodeExecutionStatus.RUNNING,
          };
        }
        // Otherwise keep the current execution status (SUCCESS, FAILED, RUNNING, etc.)
      } else {
        // Flow is not active - clean up temporary states but keep final states
        if (
          nodeData.executionStatus &&
          [NodeExecutionStatus.PENDING, NodeExecutionStatus.RUNNING].includes(
            nodeData.executionStatus,
          )
        ) {
          const { executionStatus, executionOutput, executionError, ...cleanData } = nodeData;
          processedNode.data = cleanData;
        }
      }

      return processedNode;
    });
  };

  const renderedNodes = useMemo(() => processNodesForBatchExecution(nodes), [nodes, selectedRun]);

  // Build a fingerprint of execution statuses for the exact node set rendered
  // into React Flow. This includes temporary run-state decoration applied in
  // `processNodesForBatchExecution`, not just the raw fetched node data.
  const executionFingerprint = useMemo(
    () =>
      renderedNodes
        .map((n) => {
          const d = n.data as { executionStatus?: string } | undefined;
          return `${n.id}:${d?.executionStatus ?? ''}`;
        })
        .join(','),
    [renderedNodes],
  );

  useEffect(() => {
    if (nodesInitialized && renderedNodes.length > 0) {
      // Force React Flow to re-measure handle positions for all rendered nodes.
      // Execution status styling changes node borders and shifts handle DOM
      // positions, but React Flow caches stale coordinates until internals are
      // refreshed.
      updateNodeInternals(renderedNodes.map((n) => n.id));

      setEdgesReady(false);
      const timeout = setTimeout(() => setEdgesReady(true), 80);
      return () => clearTimeout(timeout);
    }
    setEdgesReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, renderedNodes.length, executionFingerprint, updateNodeInternals]);

  const readyEdges = edgesReady ? edges : [];

  // Get current version's validation status (versions don't have isValid anymore)
  // const isValidFlow = displayVersion?.isValid;

  // Loading state
  if (loading) {
    return (
      <div className="relative w-full h-full bg-background">
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
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
    );
  }

  // Error state
  if (queryError) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="p-4 border border-red-200 rounded-lg bg-red-50">
          <div className="text-red-800">{JSON.stringify(queryError)}</div>
        </div>
      </div>
    );
  }

  // No flow state
  if (!flowData) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="text-muted-foreground">No flow data available</div>
      </div>
    );
  }

  return (
    <NodeViewProvider mode="view" onEditNode={onEditNode}>
      <div style={{ width: '100%', height: '100%', background: 'var(--canvas-background)' }}>
        <ReactFlow
          nodes={renderedNodes}
          edges={readyEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={resolvedTheme}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView={true}
          fitViewOptions={{
            padding: 0.5,
            maxZoom: 1.2,
          }}
          minZoom={0.1}
          maxZoom={4}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={true}
          edgesFocusable={false}
          elementsSelectable={true}
          onNodeClick={(_, node) => onNodeClick?.(node.id)}
          proOptions={{ hideAttribution: true }}
          panOnDrag={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={true}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </NodeViewProvider>
  );
}
