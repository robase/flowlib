import { useMemo, useCallback } from 'react';
import { newToolInstanceId, type ReactFlowNodeData } from '@flowlib/core/types';
import type { ToolDefinition, AddedToolInstance } from '../../../nodes/ToolSelectorModal';
import type { Node } from '@xyflow/react';

/**
 * Manages agent tool add/remove/update for the NodeConfigPanel.
 * Only active when nodeType is AGENT.
 */
export function useAgentToolManagement({
  nodeId,
  nodeType,
  nodeParams,
  storeNodes,
  updateNodeData,
  availableTools,
  initialToolInstanceId,
}: {
  nodeId: string | null;
  nodeType: string;
  nodeParams: Record<string, unknown>;
  storeNodes: Node[];
  updateNodeData: (nodeId: string, data: Partial<ReactFlowNodeData>) => void;
  availableTools: ToolDefinition[];
  initialToolInstanceId?: string | null;
}) {
  const addedTools = useMemo<AddedToolInstance[]>(() => {
    return (nodeParams.addedTools as AddedToolInstance[]) ?? [];
  }, [nodeParams]);

  const handleAddTool = useCallback(
    (toolId: string): string => {
      if (!nodeId) {
        return '';
      }
      const toolDef = availableTools.find((t) => t.id === toolId);
      if (!toolDef) {
        return '';
      }

      const instanceId = newToolInstanceId();
      const newInstance: AddedToolInstance = {
        instanceId,
        toolId,
        name: toolDef.name,
        description: toolDef.description,
        params: {},
      };

      const currentNode = storeNodes.find((n) => n.id === nodeId);
      const currentParams = (currentNode?.data as ReactFlowNodeData | undefined)?.params ?? {};
      const currentTools =
        ((currentParams as Record<string, unknown>).addedTools as AddedToolInstance[]) ?? [];
      updateNodeData(nodeId, {
        params: { ...currentParams, addedTools: [...currentTools, newInstance] },
      });
      return instanceId;
    },
    [nodeId, availableTools, storeNodes, updateNodeData],
  );

  const handleRemoveTool = useCallback(
    (instanceId: string) => {
      if (!nodeId) {
        return;
      }
      const currentNode = storeNodes.find((n) => n.id === nodeId);
      const currentParams = (currentNode?.data as ReactFlowNodeData | undefined)?.params ?? {};
      const currentTools =
        ((currentParams as Record<string, unknown>).addedTools as AddedToolInstance[]) ?? [];
      updateNodeData(nodeId, {
        params: {
          ...currentParams,
          addedTools: currentTools.filter((t) => t.instanceId !== instanceId),
        },
      });
    },
    [nodeId, storeNodes, updateNodeData],
  );

  const handleUpdateTool = useCallback(
    (instanceId: string, updates: Partial<Omit<AddedToolInstance, 'instanceId' | 'toolId'>>) => {
      if (!nodeId) {
        return;
      }
      const currentNode = storeNodes.find((n) => n.id === nodeId);
      const currentParams = (currentNode?.data as ReactFlowNodeData | undefined)?.params ?? {};
      const currentTools =
        ((currentParams as Record<string, unknown>).addedTools as AddedToolInstance[]) ?? [];
      updateNodeData(nodeId, {
        params: {
          ...currentParams,
          addedTools: currentTools.map((t) =>
            t.instanceId === instanceId ? { ...t, ...updates } : t,
          ),
        },
      });
    },
    [nodeId, storeNodes, updateNodeData],
  );

  const agentToolsProps = useMemo(() => {
    if (nodeType !== 'core.agent') {
      return undefined;
    }
    return {
      availableTools,
      addedTools,
      onAddTool: handleAddTool,
      onRemoveTool: handleRemoveTool,
      onUpdateTool: handleUpdateTool,
      initialToolInstanceId: initialToolInstanceId ?? null,
    };
  }, [
    nodeType,
    availableTools,
    addedTools,
    handleAddTool,
    handleRemoveTool,
    handleUpdateTool,
    initialToolInstanceId,
  ]);

  return agentToolsProps;
}
