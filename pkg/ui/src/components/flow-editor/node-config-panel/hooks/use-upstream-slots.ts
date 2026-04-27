import { useCallback, useMemo, useReducer } from 'react';
import { useFlowEditorStore } from '../../flow-editor.store';
import { useExecuteFlowToNode } from '../../../../api/executions.api';
import { useFlowActions } from '../../../../routes/flow-route-layout';
import { extractOutputValue, stringifyJson } from '../utils';
import type { UpstreamSlot, UpstreamSlotStatus } from '../types';
import type { ReactFlowNodeData } from '@flowlib/core/types';
import { useNodeRegistry } from '../../../../contexts/NodeRegistryContext';

// Extended node data type that includes preview-related properties
interface ExtendedNodeData {
  display_name?: string;
  reference_id?: string;
  type?: string;
  executionOutput?: unknown;
  previewOutput?: unknown;
  mockOutputData?: unknown;
  exampleOutput?: unknown;
}

function generateSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}

// Per-slot runtime state (loading/error) tracked by sourceNodeId
type SlotRuntimeState = {
  status: UpstreamSlotStatus;
  error: string | null;
};

type SlotAction =
  | { type: 'SET_LOADING'; nodeId: string }
  | { type: 'SET_RESOLVED'; nodeId: string }
  | { type: 'SET_ERROR'; nodeId: string; error: string }
  | { type: 'RESET'; nodeIds: string[] };

function slotReducer(
  state: Record<string, SlotRuntimeState>,
  action: SlotAction,
): Record<string, SlotRuntimeState> {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, [action.nodeId]: { status: 'loading', error: null } };
    case 'SET_RESOLVED':
      return { ...state, [action.nodeId]: { status: 'resolved', error: null } };
    case 'SET_ERROR':
      return { ...state, [action.nodeId]: { status: 'error', error: action.error } };
    case 'RESET': {
      const next = { ...state };
      for (const id of action.nodeIds) {
        delete next[id];
      }
      return next;
    }
    default:
      return state;
  }
}

interface UseUpstreamSlotsOptions {
  nodeId: string | null;
  flowId: string;
}

export function useUpstreamSlots({ nodeId, flowId }: UseUpstreamSlotsOptions) {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const updateNodeDataInStore = useFlowEditorStore((s) => s.updateNodeData);

  const executeFlowToNodeMutation = useExecuteFlowToNode();
  const flowActions = useFlowActions();
  const { getNodeDefinition } = useNodeRegistry();

  const [runtimeState, dispatch] = useReducer(slotReducer, {});

  // Build slots from incoming edges
  const slots = useMemo<UpstreamSlot[]>(() => {
    if (!nodeId) {
      return [];
    }

    const incomingEdges = edges.filter((edge) => edge.target === nodeId);
    if (incomingEdges.length === 0) {
      return [];
    }

    const result: UpstreamSlot[] = [];

    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) {
        continue;
      }

      const sourceData = sourceNode.data as ExtendedNodeData;
      const displayName = sourceData.display_name || sourceNode.id;
      const key = sourceData.reference_id || generateSlug(displayName);
      const nodeType = sourceData.type || '';
      const nodeDef = nodeType ? getNodeDefinition(nodeType) : undefined;

      const output =
        sourceData.previewOutput ??
        sourceData.executionOutput ??
        sourceData.mockOutputData ??
        sourceData.exampleOutput ??
        null;

      const runtime = runtimeState[sourceNode.id];
      let status: UpstreamSlotStatus;
      let error: string | null = null;

      if (runtime?.status === 'loading') {
        status = 'loading';
      } else if (runtime?.status === 'error') {
        status = 'error';
        error = runtime.error;
      } else if (output !== null && output !== undefined) {
        status = 'resolved';
      } else {
        status = 'idle';
      }

      result.push({
        key,
        sourceNodeId: sourceNode.id,
        sourceLabel: displayName,
        sourceType: nodeType,
        sourceIcon: nodeDef?.icon,
        status,
        output: status === 'resolved' ? output : null,
        error,
      });
    }

    return result;
  }, [nodeId, nodes, edges, runtimeState]);

  const slotMap = useMemo(() => new Map(slots.map((s) => [s.key, s])), [slots]);

  const isAnyLoading = useMemo(() => slots.some((s) => s.status === 'loading'), [slots]);

  // Collect all transitive ancestors that are NOT directly connected
  const indirectAncestors = useMemo(() => {
    if (!nodeId) {
      return {};
    }

    // Direct parent node IDs
    const directParentIds = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source));

    // BFS to find all transitive ancestors
    const allAncestorIds = new Set<string>();
    const queue = [...directParentIds];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      const parentEdges = edges.filter((e) => e.target === current);
      for (const pe of parentEdges) {
        if (!allAncestorIds.has(pe.source) && !directParentIds.has(pe.source)) {
          allAncestorIds.add(pe.source);
          queue.push(pe.source);
        }
      }
    }

    if (allAncestorIds.size === 0) {
      return {};
    }

    const result: Record<string, unknown> = {};
    for (const ancestorId of allAncestorIds) {
      const ancestorNode = nodes.find((n) => n.id === ancestorId);
      if (!ancestorNode) {
        continue;
      }
      const data = ancestorNode.data as ExtendedNodeData;
      const displayName = data.display_name || ancestorNode.id;
      const key = data.reference_id || generateSlug(displayName);
      const output =
        data.previewOutput ??
        data.executionOutput ??
        data.mockOutputData ??
        data.exampleOutput ??
        null;
      result[key] = output;
    }
    return result;
  }, [nodeId, nodes, edges]);

  // Derive the input preview JSON from slots + indirect ancestors
  const inputPreviewJson = useMemo(() => {
    if (slots.length === 0) {
      return stringifyJson({});
    }
    const obj: Record<string, unknown> = {};
    for (const slot of slots) {
      obj[slot.key] = slot.status === 'resolved' ? slot.output : null;
    }
    if (Object.keys(indirectAncestors).length > 0) {
      obj.previous_nodes = indirectAncestors;
    }
    return stringifyJson(obj);
  }, [slots, indirectAncestors]);

  // Run a single upstream slot
  const runSlot = useCallback(
    async (slot: UpstreamSlot) => {
      if (!flowId) {
        return;
      }

      dispatch({ type: 'SET_LOADING', nodeId: slot.sourceNodeId });

      // Auto-save before running
      if (flowActions?.onSave) {
        const saved = await flowActions.onSave({ skipSuccessToast: true });
        if (!saved) {
          dispatch({
            type: 'SET_ERROR',
            nodeId: slot.sourceNodeId,
            error: 'Failed to save flow',
          });
          return;
        }
      }

      try {
        const result = (await executeFlowToNodeMutation.mutateAsync({
          flowId,
          nodeId: slot.sourceNodeId,
          inputs: {},
          options: { useBatchProcessing: false },
        })) as {
          status: string;
          error?: string;
          outputs?: Record<string, unknown>;
          nodeErrors?: Record<string, string>;
          traces?: Array<{ nodeId: string; inputs: unknown; outputs: unknown }>;
        };

        if (result.status === 'SUCCESS') {
          // Hydrate ALL executed nodes into the store
          if (result.outputs) {
            for (const [executedNodeId, nodeOutput] of Object.entries(result.outputs)) {
              const extracted = extractOutputValue(nodeOutput);
              updateNodeDataInStore(executedNodeId, {
                previewOutput: extracted,
              } as Partial<ReactFlowNodeData>);
            }
          }
          dispatch({ type: 'SET_RESOLVED', nodeId: slot.sourceNodeId });
        } else if (result.status === 'PAUSED_FOR_BATCH') {
          dispatch({
            type: 'SET_ERROR',
            nodeId: slot.sourceNodeId,
            error: 'Paused for batch processing',
          });
        } else {
          const errorMsg =
            result.nodeErrors?.[slot.sourceNodeId] || result.error || 'Execution failed';
          dispatch({
            type: 'SET_ERROR',
            nodeId: slot.sourceNodeId,
            error: errorMsg,
          });
        }
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          nodeId: slot.sourceNodeId,
          error: err instanceof Error ? err.message : 'Unexpected error',
        });
      }
    },
    [flowId, flowActions, executeFlowToNodeMutation, updateNodeDataInStore],
  );

  // Run all unresolved slots sequentially
  const runAllUnresolved = useCallback(async () => {
    const unresolvedSlots = slots.filter((s) => s.status === 'idle' || s.status === 'error');
    for (const slot of unresolvedSlots) {
      await runSlot(slot);
    }
  }, [slots, runSlot]);

  const unresolvedCount = useMemo(
    () => slots.filter((s) => s.status === 'idle' || s.status === 'error').length,
    [slots],
  );

  // Get upstream variable keys (for template suggestions in the config panel)
  const upstreamVariables = useMemo(() => slots.map((s) => s.key), [slots]);

  return {
    slots,
    slotMap,
    inputPreviewJson,
    runSlot,
    runAllUnresolved,
    isAnyLoading,
    unresolvedCount,
    upstreamVariables,
  };
}
