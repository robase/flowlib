import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { FlowRunResult } from '@flowlib/core/types';
import { parseJson, stringifyJson } from './utils';

/**
 * State for the node config panel
 */
interface NodeConfigPanelState {
  // Panel state
  nodeId: string | null;
  flowId: string | null;

  // Input/Output previews
  inputPreview: string;
  outputPreview: string;
  inputError: string | null;
  outputError: string | null;

  // Test mode
  isTestMode: boolean;
  originalInputPreview: string | null;

  // Execution state
  isRunningNode: boolean;
  runError: string | null;

  // Credential modal
  isCreateCredentialOpen: boolean;
  activeCredentialField: string | null;
}

/**
 * Actions for the node config panel
 */
interface NodeConfigPanelActions {
  // Initialization
  initializeForNode: (
    nodeId: string,
    flowId: string,
    initialInput: string,
    initialOutput: string,
  ) => void;
  reset: () => void;

  // Input preview
  setInputPreview: (value: string) => void;
  setInputError: (error: string | null) => void;

  // Output preview
  setOutputPreview: (value: string) => void;
  setOutputError: (error: string | null) => void;

  // Test mode
  enterTestMode: () => void;
  exitTestMode: () => void;
  resetTestMode: () => void;

  // Execution
  setIsRunningNode: (isRunning: boolean) => void;
  setRunError: (error: string | null) => void;

  // Credential modal
  openCreateCredentialModal: (fieldName: string) => void;
  closeCreateCredentialModal: () => void;

  // Execution result handlers
  handleTestModeSuccess: (output: unknown) => void;
  handleNormalModeSuccess: (
    result: FlowRunResult,
    nodeId: string,
    updateNodeData: (nodeId: string, data: Record<string, unknown>) => void,
  ) => void;
  handleExecutionError: (error: string) => void;
}

type NodeConfigPanelStore = NodeConfigPanelState & NodeConfigPanelActions;

const initialState: NodeConfigPanelState = {
  nodeId: null,
  flowId: null,
  inputPreview: '{}',
  outputPreview: '{}',
  inputError: null,
  outputError: null,
  isTestMode: false,
  originalInputPreview: null,
  isRunningNode: false,
  runError: null,
  isCreateCredentialOpen: false,
  activeCredentialField: null,
};

/**
 * Extract the output value from a node execution result
 */
function extractOutputValue(nodeOutput: unknown): unknown {
  if (!nodeOutput || typeof nodeOutput !== 'object') {
    return null;
  }

  const typedOutput = nodeOutput as { data?: { variables?: Record<string, { value: unknown }> } };

  if (typedOutput.data?.variables?.output) {
    const outputVar = typedOutput.data.variables.output;
    return outputVar && typeof outputVar === 'object' && 'value' in outputVar
      ? outputVar.value
      : outputVar;
  }

  if (typedOutput.data?.variables) {
    const firstVar = Object.values(typedOutput.data.variables)[0];
    return firstVar && typeof firstVar === 'object' && 'value' in firstVar
      ? firstVar.value
      : firstVar;
  }

  return null;
}

/**
 * Format output for display - strings as-is, objects as JSON
 */
function formatOutputForDisplay(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  return stringifyJson(output);
}

/**
 * Zustand store for node config panel state management
 */
export const useNodeConfigPanelStore = create<NodeConfigPanelStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      initializeForNode: (nodeId, flowId, initialInput, initialOutput) => {
        set({
          nodeId,
          flowId,
          inputPreview: initialInput,
          outputPreview: initialOutput,
          originalInputPreview: initialInput,
          inputError: null,
          outputError: null,
          isTestMode: false,
          runError: null,
        });
      },

      reset: () => {
        set(initialState);
      },

      setInputPreview: (value) => {
        const { originalInputPreview } = get();
        const isTestMode = originalInputPreview !== null && value !== originalInputPreview;

        set({
          inputPreview: value,
          inputError: null,
          isTestMode,
        });
      },

      setInputError: (error) => {
        set({ inputError: error });
      },

      setOutputPreview: (value) => {
        set({
          outputPreview: value,
          outputError: null,
        });
      },

      setOutputError: (error) => {
        set({ outputError: error });
      },

      enterTestMode: () => {
        set({ isTestMode: true });
      },

      exitTestMode: () => {
        set({ isTestMode: false });
      },

      resetTestMode: () => {
        const { originalInputPreview } = get();
        if (originalInputPreview !== null) {
          set({
            inputPreview: originalInputPreview,
            isTestMode: false,
          });
        }
      },

      setIsRunningNode: (isRunning) => {
        set({ isRunningNode: isRunning });
      },

      setRunError: (error) => {
        set({ runError: error });
      },

      openCreateCredentialModal: (fieldName) => {
        set({
          isCreateCredentialOpen: true,
          activeCredentialField: fieldName,
        });
      },

      closeCreateCredentialModal: () => {
        set({
          isCreateCredentialOpen: false,
          activeCredentialField: null,
        });
      },

      handleTestModeSuccess: (output) => {
        const displayValue = formatOutputForDisplay(output);
        set({
          outputPreview: displayValue,
          outputError: null,
          runError: null,
        });
      },

      handleNormalModeSuccess: (result, nodeId, updateNodeData) => {
        // Update input/output data for all executed nodes from traces
        if (result.traces && Array.isArray(result.traces)) {
          for (const trace of result.traces) {
            const traceNodeId = trace.nodeId;
            if (!traceNodeId) {
              continue;
            }

            const traceInputs = trace.inputs;
            const traceOutput = extractOutputValue(trace.outputs);

            updateNodeData(traceNodeId, {
              previewInput: traceInputs,
              previewOutput: traceOutput,
            });
          }
        }

        // Update local state for the current node's output display
        const nodeOutput = result.outputs?.[nodeId];
        const output = extractOutputValue(nodeOutput);
        const displayValue = formatOutputForDisplay(output);

        // Update input preview from the current node's trace
        const currentTrace = result.traces?.find((t: { nodeId: string }) => t.nodeId === nodeId);
        const newInputPreview = currentTrace?.inputs
          ? stringifyJson(currentTrace.inputs)
          : get().inputPreview;

        set({
          outputPreview: displayValue,
          outputError: null,
          runError: null,
          inputPreview: newInputPreview,
          originalInputPreview: newInputPreview,
          isTestMode: false,
        });
      },

      handleExecutionError: (error) => {
        set({
          runError: error,
          outputError: error,
        });
      },
    }),
    { name: 'node-config-panel' },
  ),
);

/**
 * Hook to get parsed input data for test mode execution
 */
export function useParsedInputPreview(): Record<string, unknown> {
  const inputPreview = useNodeConfigPanelStore((state) => state.inputPreview);
  return parseJson(inputPreview, () => ({})) || {};
}
