import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { parseJson, stringifyJson } from '../utils';
import { useFlowEditorStore } from '../../flow-editor.store';
import type { ReactFlowNodeData } from '@flowlib/core/types';

/**
 * Generate a slug from a label string (snake_case, alphanumeric only)
 */
function generateSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}

/**
 * Compute input data for a node based on its incoming edges.
 * Maps output data from source nodes using their reference_id as keys.
 * Structure matches the backend's buildIncomingDataObject format for template resolution.
 *
 * Example output:
 * {
 *   "some_node": { output: "value from some_node" },
 *   "other_node": { output: "value from other_node" }
 * }
 */
// Extended node data type that includes preview-related properties
// These are runtime properties added during editing, not part of the base ReactFlowNodeData type
interface ExtendedNodeData {
  id?: string;
  type?: string;
  display_name?: string;
  reference_id?: string;
  status?: string;
  executionStatus?: string;
  executionError?: string;
  executionOutput?: unknown;
  params?: Record<string, unknown>;
  inputs?: unknown;
  outputs?: unknown;
  // Preview/editor-specific properties
  previewInput?: unknown;
  previewOutput?: unknown;
  mockInputData?: unknown;
  mockOutputData?: unknown;
  lastInputs?: unknown;
  exampleInput?: unknown;
  exampleOutput?: unknown;
}

function computeInputFromEdges(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
): Record<string, unknown> {
  const incomingEdges = edges.filter((edge) => edge.target === targetNodeId);

  if (incomingEdges.length === 0) {
    return {};
  }

  const inputData: Record<string, unknown> = {};

  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) {
      continue;
    }

    // Cast to access ReactFlowNodeData properties at runtime
    const sourceNodeData = sourceNode.data as ExtendedNodeData;
    const displayName = sourceNodeData.display_name || sourceNode.id;

    // Use reference_id if available, otherwise generate slug from display name
    const slug = sourceNodeData.reference_id || generateSlug(displayName);

    // Get the output data from the source node
    const sourceOutput =
      sourceNodeData.previewOutput ??
      sourceNodeData.executionOutput ??
      sourceNodeData.mockOutputData ??
      sourceNodeData.exampleOutput;

    if (sourceOutput !== undefined && sourceOutput !== null) {
      // Map directly: { slug: outputValue }
      // This allows templates to use {{ slug }} directly for the output value
      inputData[slug] = sourceOutput;
    } else {
      // Source node has not been run yet - show placeholder
      inputData[slug] = `[NO DATA]`;
    }
  }

  return inputData;
}

interface UsePreviewStateOptions {
  nodeId: string | null;
  updateNodeData: (nodeId: string, data: Partial<ReactFlowNodeData>) => void;
}

export function usePreviewState({ nodeId, updateNodeData }: UsePreviewStateOptions) {
  // Use Zustand store as source of truth instead of React Flow's internal store
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);

  // Find the current node from our store
  const node = useMemo(() => {
    if (!nodeId) {
      return null;
    }
    return nodes.find((n) => n.id === nodeId) ?? null;
  }, [nodeId, nodes]);

  const [inputPreview, setInputPreview] = useState('');
  const [outputPreview, setOutputPreview] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [outputError, setOutputError] = useState<string | null>(null);

  // Test mode state
  const [isTestMode, setIsTestMode] = useState(false);
  const [originalInputPreview, setOriginalInputPreview] = useState<string | null>(null);

  const prevNodeIdRef = useRef<string | null>(null);

  // Initialize previews when node changes
  useEffect(() => {
    const nodeIdChanged = prevNodeIdRef.current !== nodeId;
    prevNodeIdRef.current = nodeId;

    if (!node || !nodeId) {
      setInputPreview('');
      setOutputPreview('');
      setInputError(null);
      setOutputError(null);
      setIsTestMode(false);
      setOriginalInputPreview(null);
      return;
    }

    if (nodeIdChanged) {
      // Cast to extended type to access preview properties
      const currentNodeData = node.data as ExtendedNodeData;
      const computedInput = computeInputFromEdges(nodeId, nodes, edges);
      const hasComputedInput = Object.keys(computedInput).length > 0;

      let initialInput: string;
      if (currentNodeData.previewInput) {
        initialInput = stringifyJson(currentNodeData.previewInput);
      } else if (hasComputedInput) {
        initialInput = stringifyJson(computedInput);
      } else {
        initialInput = stringifyJson(
          currentNodeData.mockInputData ??
            currentNodeData.lastInputs ??
            currentNodeData.exampleInput ??
            {},
        );
      }

      setInputPreview(initialInput);
      setOriginalInputPreview(initialInput);
      setIsTestMode(false);

      setOutputPreview(
        stringifyJson(
          currentNodeData.previewOutput ??
            currentNodeData.executionOutput ??
            currentNodeData.mockOutputData ??
            currentNodeData.exampleOutput ??
            {},
        ),
      );

      setInputError(null);
      setOutputError(null);
    }
  }, [nodeId, nodes, edges, node]);

  const handleInputPreviewChange = useCallback(
    (value: string) => {
      setInputPreview(value);
      setInputError(null);

      if (originalInputPreview !== null && value !== originalInputPreview) {
        setIsTestMode(true);
      } else if (value === originalInputPreview) {
        setIsTestMode(false);
      }

      if (nodeId) {
        const parsed = parseJson(value, setInputError);
        if (parsed !== null) {
          // Note: previewInput is an extended property, cast is needed
          updateNodeData(nodeId, { previewInput: parsed } as Partial<ReactFlowNodeData>);
        }
      }
    },
    [nodeId, updateNodeData, originalInputPreview],
  );

  const handleOutputPreviewChange = useCallback(
    (value: string) => {
      setOutputPreview(value);
      setOutputError(null);

      if (nodeId) {
        const parsed = parseJson(value, setOutputError);
        if (parsed !== null) {
          // Note: previewOutput is an extended property, cast is needed
          updateNodeData(nodeId, { previewOutput: parsed } as Partial<ReactFlowNodeData>);
        }
      }
    },
    [nodeId, updateNodeData],
  );

  const handleResetTestMode = useCallback(() => {
    if (originalInputPreview !== null) {
      setInputPreview(originalInputPreview);
      setIsTestMode(false);

      if (nodeId) {
        const parsed = parseJson(originalInputPreview, setInputError);
        if (parsed !== null) {
          // Note: previewInput is an extended property, cast is needed
          updateNodeData(nodeId, { previewInput: parsed } as Partial<ReactFlowNodeData>);
        }
      }
    }
  }, [originalInputPreview, nodeId, updateNodeData]);

  const updateFromExecution = useCallback((newInput: string, newOutput: string) => {
    setInputPreview(newInput);
    setOriginalInputPreview(newInput);
    setOutputPreview(newOutput);
    setIsTestMode(false);
  }, []);

  // Refresh input preview from edges (used after running upstream nodes)
  const refreshInputFromEdges = useCallback(() => {
    if (!nodeId) {
      return;
    }

    const computedInput = computeInputFromEdges(nodeId, nodes, edges);
    const newInputStr = stringifyJson(computedInput);

    setInputPreview(newInputStr);
    setOriginalInputPreview(newInputStr);
    setIsTestMode(false);
    setInputError(null);
  }, [nodeId, nodes, edges]);

  // Get upstream variable names (reference IDs from connected upstream nodes)
  const upstreamVariables = useMemo(() => {
    if (!nodeId) {
      return [];
    }
    const computedInput = computeInputFromEdges(nodeId, nodes, edges);
    return Object.keys(computedInput);
  }, [nodeId, nodes, edges]);

  return {
    inputPreview,
    outputPreview,
    inputError,
    outputError,
    isTestMode,
    originalInputPreview,
    upstreamVariables,
    setInputPreview,
    setOutputPreview,
    setInputError,
    setOutputError,
    handleInputPreviewChange,
    handleOutputPreviewChange,
    handleResetTestMode,
    updateFromExecution,
    refreshInputFromEdges,
  };
}
