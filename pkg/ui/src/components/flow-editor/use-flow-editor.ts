import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { Node, Edge } from '@xyflow/react';
import { useFlowReactFlowData, useCreateFlowVersion } from '../../api/flows.api';
import { useExecuteFlow } from '../../api/executions.api';
import { useFlowEditorStore, useIsDirty, type LayoutDirection } from './flow-editor.store';
import { transformToFlowlibDefinition } from '~/utils/flowTransformations';
import { applyLayout, type LayoutAlgorithm } from '~/utils/layoutUtils';

// Simple toast helper (can be replaced with proper toast library)
const toast = (options: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => {
  console.log(
    `[${options.variant === 'destructive' ? 'ERROR' : 'INFO'}] ${options.title}:`,
    options.description,
  );
};

interface UseFlowEditorOptions {
  flowId: string;
  version?: string;
  basePath?: string;
}

/**
 * Main hook that wires React Query with Zustand for the flow editor.
 *
 * React Query handles:
 * - Fetching flow data from the server
 * - Caching and background refetching
 * - Mutation (save) operations
 *
 * Zustand handles:
 * - Local node/edge state (working copy)
 * - Dirty tracking
 * - Selection state
 * - UI state (panels, layout)
 */
export function useFlowEditor({ flowId, version, basePath = '' }: UseFlowEditorOptions) {
  const navigate = useNavigate();

  // React Query - server state
  const {
    data: flowData,
    isLoading,
    error: queryError,
    refetch,
  } = useFlowReactFlowData(flowId, { version });

  const createVersionMutation = useCreateFlowVersion();
  const executeFlowMutation = useExecuteFlow();

  // Zustand - client state (individual selectors for fine-grained re-renders)
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const currentLayout = useFlowEditorStore((s) => s.currentLayout);
  const layoutDirection = useFlowEditorStore((s) => s.layoutDirection);
  const syncFromServer = useFlowEditorStore((s) => s.syncFromServer);
  const markSaved = useFlowEditorStore((s) => s.markSaved);
  const setFlowId = useFlowEditorStore((s) => s.setFlowId);

  // flowName lives in React Query cache, not Zustand
  const flowName = flowData?.name ?? 'Untitled Flow';

  // Content-based dirty detection (derived from snapshot comparison)
  const isDirty = useIsDirty();

  // Initialize flow ID in store
  useEffect(() => {
    setFlowId(flowId, version);
  }, [flowId, version, setFlowId]);

  // Sync server data to Zustand when React Query fetches new data
  useEffect(() => {
    if (flowData?.nodes && flowData?.edges) {
      const versionInfo = flowData.version;
      const versionId = versionInfo
        ? `${versionInfo.flowId}:${versionInfo.version}`
        : `${flowId}:unknown`;

      // Server returns ReactFlowNode[] which is compatible with Node[]
      syncFromServer(flowData.nodes as Node[], flowData.edges as Edge[], versionId);
    }
  }, [flowData, flowId, syncFromServer]);

  // Save handler - persists Zustand state to server via React Query mutation
  const save = useCallback(
    async (options?: { skipSuccessToast?: boolean }) => {
      if (!flowId) {
        return false;
      }

      if (!nodes.length) {
        toast({
          title: 'Flow is empty',
          description: 'Add at least one node before saving.',
        });
        return false;
      }

      try {
        const flowlibDefinition = transformToFlowlibDefinition(nodes, edges);

        const result = await createVersionMutation.mutateAsync({
          flowId,
          data: { flowlibDefinition },
        });

        // Mark as saved with new version ID
        const savedVersionId = result ? `${result.flowId}:${result.version}` : undefined;
        if (savedVersionId) {
          markSaved(savedVersionId);
        }

        if (!options?.skipSuccessToast) {
          toast({
            title: 'Success',
            description: 'Flow saved successfully',
          });
        }

        return true;
      } catch (error: unknown) {
        console.error('Save error:', error);
        const message = error instanceof Error ? error.message : 'Failed to save flow';
        toast({
          title: 'Save Failed',
          description: message,
          variant: 'destructive',
        });
        return false;
      }
    },
    [flowId, nodes, edges, createVersionMutation, markSaved],
  );

  // Execute handler - saves then executes
  const execute = useCallback(async () => {
    if (!flowId) {
      return;
    }

    // Save first
    const saved = await save({ skipSuccessToast: true });
    if (!saved) {
      return;
    }

    try {
      // Start execution and wait for the flow run ID
      const result = await executeFlowMutation.mutateAsync({
        flowId,
        inputs: {},
        useBatchProcessing: false,
      });

      toast({
        title: 'Execution Started',
        description: 'Flow is now running',
      });

      // Land in edit-live: stay on the editor route with ?runId= so node
      // status decorations stream onto the editable canvas and the logs panel
      // mounts collapsed. Whoever triggered the run (editor or runs view)
      // is pulled into edit-live for the new run — that matches the "I just
      // ran this, let me keep iterating" intent.
      if (result?.flowRunId) {
        navigate(`${basePath}/flow/${flowId}?runId=${result.flowRunId}`);
      } else {
        navigate(`${basePath}/flow/${flowId}`);
      }
    } catch (error: unknown) {
      console.error('Execute error:', error);
      const message = error instanceof Error ? error.message : 'Failed to start execution';
      toast({
        title: 'Execution Failed',
        description: message,
        variant: 'destructive',
      });
    }
  }, [flowId, save, executeFlowMutation, navigate, basePath]);

  // Apply layout to nodes
  const applyLayoutToNodes = useCallback(
    async (
      algorithm: LayoutAlgorithm = currentLayout as LayoutAlgorithm,
      direction: LayoutDirection = layoutDirection,
    ) => {
      const { nodes: layoutedNodes } = await applyLayout(nodes, edges, algorithm, direction);
      useFlowEditorStore.getState().setLayoutedNodes(layoutedNodes);
      useFlowEditorStore.getState().setLayout(algorithm, direction);
    },
    [nodes, edges, currentLayout, layoutDirection],
  );

  return {
    // Data
    flowId,
    flowName,
    nodes,
    edges,
    isActive: flowData?.isActive,

    // Loading states
    isLoading,
    error: queryError?.message ?? null,

    // Dirty state
    isDirty,

    // Save/Execute
    save,
    execute,
    isSaving: createVersionMutation.isPending,
    isExecuting: executeFlowMutation.isPending,

    // Layout
    currentLayout,
    layoutDirection,
    applyLayout: applyLayoutToNodes,

    // Refetch from server
    refetch,
  };
}
