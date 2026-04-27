import { useCallback, useMemo, useRef } from 'react';
import { newToolInstanceId } from '@flowlib/core/types';
import { useFlowEditorStore } from './flow-editor.store';
import { useAgentTools } from '~/api/agent-tools.api';
import type { ToolDefinition, AddedToolInstance } from '../nodes/ToolSelectorModal';
import type { AgentToolCallbacks } from '~/contexts/AgentToolCallbacksContext';

// Stable empty array to avoid re-render cascades when no tool panel node is selected
const EMPTY_TOOLS: AddedToolInstance[] = [];

export function useToolPanel() {
  // Tool panel state from Zustand store
  const toolSelectorPanelOpen = useFlowEditorStore((s) => s.toolSelectorOpen);
  const toolConfigPanelOpen = useFlowEditorStore((s) => s.toolConfigOpen);
  const toolPanelNodeId = useFlowEditorStore((s) => s.toolPanelNodeId);
  const selectedToolInstanceId = useFlowEditorStore((s) => s.selectedToolInstanceId);
  const configPanelToolInstanceId = useFlowEditorStore((s) => s.configPanelToolInstanceId);
  const closeToolSelector = useFlowEditorStore((s) => s.closeToolSelector);
  const closeToolConfig = useFlowEditorStore((s) => s.closeToolConfig);
  const setConfigPanelToolInstanceId = useFlowEditorStore((s) => s.setConfigPanelToolInstanceId);
  const openConfigPanel = useFlowEditorStore((s) => s.openConfigPanel);
  const openToolConfig = useFlowEditorStore((s) => s.openToolConfig);
  const updateNodeData = useFlowEditorStore((s) => s.updateNodeData);
  const storeNodes = useFlowEditorStore((s) => s.nodes);

  const sidebarMode = toolSelectorPanelOpen ? ('actions' as const) : ('nodes' as const);

  // Fetch available tools from API
  const { data: agentToolsData } = useAgentTools();

  const availableTools: ToolDefinition[] = useMemo(() => {
    if (!agentToolsData) {
      return [];
    }
    return agentToolsData
      .filter((tool) => tool.provider?.id !== 'triggers' && !tool.id.startsWith('trigger.'))
      .map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category as ToolDefinition['category'],
        tags: tool.tags,
        inputSchema: tool.inputSchema,
        nodeType: tool.nodeType,
        docsUrl: undefined,
        provider: tool.provider,
      }));
  }, [agentToolsData]);

  // Stable callback refs for tool actions (avoids re-renders when passing to nodes)
  const noop = () => {
    /* placeholder, replaced on first render */
  };
  const openToolSelectorRef = useRef<(nodeId: string) => void>(noop);
  const showMoreToolsRef = useRef<(nodeId: string) => void>(noop);
  const removeToolRef = useRef<(nodeId: string, toolId: string) => void>(noop);
  const toolClickRef = useRef<(nodeId: string, instanceId: string) => void>(noop);

  // --- Handlers ---

  const handleOpenToolSelector = useCallback(
    (nodeId: string) => {
      setConfigPanelToolInstanceId(null);
      openConfigPanel(nodeId);
    },
    [openConfigPanel],
  );

  const handleShowMoreTools = useCallback(
    (nodeId: string) => {
      setConfigPanelToolInstanceId(null);
      openConfigPanel(nodeId);
    },
    [openConfigPanel],
  );

  const handleToolClick = useCallback(
    (nodeId: string, instanceId: string) => {
      setConfigPanelToolInstanceId(instanceId);
      openConfigPanel(nodeId);
    },
    [openConfigPanel],
  );

  const handleCloseToolSelector = useCallback(() => {
    closeToolSelector();
  }, [closeToolSelector]);

  const handleCloseToolConfig = useCallback(() => {
    closeToolConfig();
  }, [closeToolConfig]);

  const handleSelectToolInstance = useCallback(
    (instance: AddedToolInstance) => {
      if (toolPanelNodeId) {
        openToolConfig(toolPanelNodeId, instance.instanceId);
      }
    },
    [toolPanelNodeId, openToolConfig],
  );

  // Keep refs in sync
  openToolSelectorRef.current = handleOpenToolSelector;
  showMoreToolsRef.current = handleShowMoreTools;

  // Get added tools for a node
  const getAddedToolsForNode = useCallback((nodeId: string): AddedToolInstance[] => {
    const node = useFlowEditorStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) {
      return [];
    }
    const params = (node.data as Record<string, unknown>)?.params as Record<string, unknown>;
    return (params?.addedTools as AddedToolInstance[]) || [];
  }, []);

  const handleAddToolToNode = useCallback(
    (toolId: string): string => {
      if (!toolPanelNodeId) {
        return '';
      }
      const node = useFlowEditorStore.getState().nodes.find((n) => n.id === toolPanelNodeId);
      if (!node) {
        return '';
      }

      const toolDef = availableTools.find((t) => t.id === toolId);
      if (!toolDef) {
        return '';
      }

      const instanceId = newToolInstanceId();
      const newInstance: AddedToolInstance = {
        instanceId,
        toolId: toolId,
        name: toolDef.name,
        description: toolDef.description,
        params: {},
      };

      const currentTools = getAddedToolsForNode(toolPanelNodeId);
      updateNodeData(toolPanelNodeId, {
        params: {
          ...((node.data as Record<string, unknown>)?.params as Record<string, unknown>),
          addedTools: [...currentTools, newInstance],
        },
      });

      return instanceId;
    },
    [toolPanelNodeId, availableTools, getAddedToolsForNode, updateNodeData],
  );

  const handleRemoveToolFromNode = useCallback(
    (instanceId: string) => {
      if (!toolPanelNodeId) {
        return;
      }
      const node = useFlowEditorStore.getState().nodes.find((n) => n.id === toolPanelNodeId);
      if (!node) {
        return;
      }

      const currentTools = getAddedToolsForNode(toolPanelNodeId);
      updateNodeData(toolPanelNodeId, {
        params: {
          ...((node.data as Record<string, unknown>)?.params as Record<string, unknown>),
          addedTools: currentTools.filter((t) => t.instanceId !== instanceId),
        },
      });
      if (selectedToolInstanceId === instanceId) {
        closeToolConfig();
      }
    },
    [
      toolPanelNodeId,
      getAddedToolsForNode,
      selectedToolInstanceId,
      updateNodeData,
      closeToolConfig,
    ],
  );

  const handleUpdateToolInNode = useCallback(
    (instanceId: string, updates: Partial<Omit<AddedToolInstance, 'instanceId' | 'toolId'>>) => {
      if (!toolPanelNodeId) {
        return;
      }
      const node = useFlowEditorStore.getState().nodes.find((n) => n.id === toolPanelNodeId);
      if (!node) {
        return;
      }

      const currentTools = getAddedToolsForNode(toolPanelNodeId);
      updateNodeData(toolPanelNodeId, {
        params: {
          ...((node.data as Record<string, unknown>)?.params as Record<string, unknown>),
          addedTools: currentTools.map((t) =>
            t.instanceId === instanceId ? { ...t, ...updates } : t,
          ),
        },
      });
    },
    [toolPanelNodeId, getAddedToolsForNode, updateNodeData],
  );

  const handleRemoveToolFromSpecificNode = useCallback(
    (nodeId: string, instanceId: string) => {
      const node = useFlowEditorStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) {
        return;
      }

      const params = (node.data as Record<string, unknown>)?.params as Record<string, unknown>;
      const currentTools = (params?.addedTools as AddedToolInstance[]) || [];
      updateNodeData(nodeId, {
        params: {
          ...params,
          addedTools: currentTools.filter((t) => t.instanceId !== instanceId),
        },
      });
    },
    [updateNodeData],
  );

  // Keep refs in sync
  removeToolRef.current = handleRemoveToolFromSpecificNode;
  toolClickRef.current = handleToolClick;

  // Agent tool callbacks context value
  const agentToolCallbacks = useMemo<AgentToolCallbacks>(
    () => ({
      onOpenToolSelector: (nodeId: string) => openToolSelectorRef.current(nodeId),
      onShowMoreTools: (nodeId: string) => showMoreToolsRef.current(nodeId),
      onRemoveTool: (nodeId: string, instanceId: string) =>
        removeToolRef.current(nodeId, instanceId),
      onToolClick: (nodeId: string, instanceId: string) => toolClickRef.current(nodeId, instanceId),
      availableTools,
      selectedToolNodeId: toolPanelNodeId,
      selectedToolInstanceId,
    }),
    [availableTools, toolPanelNodeId, selectedToolInstanceId],
  );

  // Compute current added tools for the selected node
  const currentNodeAddedTools = useMemo(() => {
    if (!toolPanelNodeId) {
      return EMPTY_TOOLS;
    }
    return getAddedToolsForNode(toolPanelNodeId);
  }, [toolPanelNodeId, getAddedToolsForNode, storeNodes]);

  const selectedToolInstance = selectedToolInstanceId
    ? (currentNodeAddedTools.find((t) => t.instanceId === selectedToolInstanceId) ?? null)
    : null;
  const selectedToolDef = selectedToolInstance
    ? (availableTools.find((t) => t.id === selectedToolInstance.toolId) ?? null)
    : null;

  return {
    // State
    sidebarMode,
    toolConfigPanelOpen,
    toolPanelNodeId,
    selectedToolInstanceId,
    configPanelToolInstanceId,
    availableTools,
    currentNodeAddedTools,
    selectedToolInstance,
    selectedToolDef,
    agentToolCallbacks,

    // Actions
    setConfigPanelToolInstanceId,
    openConfigPanel,
    handleCloseToolSelector,
    handleCloseToolConfig,
    handleAddToolToNode,
    handleRemoveToolFromNode,
    handleUpdateToolInNode,
    handleSelectToolInstance,
  };
}
