import { useMemo, useCallback } from 'react';
import type { ReactFlowNodeData } from '@flowlib/core/types';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../ui/dialog';
import { X } from 'lucide-react';
import { ResizablePanelGroup, ResizableHandle } from '../../ui/resizable';
import { cn } from '../../../lib/utils';
import { useNodeRegistry } from '../../../contexts/NodeRegistryContext';
import { useExecuteFlowToNode, useTestNode } from '../../../api/executions.api';
import { useTestMapper } from '../../../api/node-data.api';
import { CreateCredentialModal } from '../../credentials/CreateCredentialModal';
import { EditCredentialModal } from '../../credentials/EditCredentialModal';

import { formatNodeTypeLabel, getIconComponent } from './utils';
import { useNodeConfigState } from './use-node-config-state';
import { updateReferenceIdForDisplayName } from '../../../utils/nodeReferenceUtils';
import { useFlowActions } from '../../../routes/flow-route-layout';
import {
  usePreviewState,
  useNodeExecution,
  useOAuth2Refresh,
  useNodeCredentials,
  useAgentToolManagement,
} from './hooks';
import { useUpstreamSlots } from './hooks/use-upstream-slots';
import { InputPanel, OutputPanel, ConfigurationPanel } from './panels';
import { useFlowEditorStore } from '../flow-editor.store';
import type { ToolDefinition } from '../../nodes/ToolSelectorModal';

interface NodeConfigPanelProps {
  nodeId: string | null;
  flowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
  /** Available agent tools — only needed for AGENT node type */
  availableTools?: ToolDefinition[];
  /** If set, open the Tools tab with this instance pre-selected */
  initialToolInstanceId?: string | null;
}

export function NodeConfigPanel({
  nodeId,
  flowId,
  open,
  onOpenChange,
  portalContainer,
  availableTools = [],
  initialToolInstanceId,
}: NodeConfigPanelProps) {
  const { getNodeDefinition } = useNodeRegistry();

  const updateNodeDataInStore = useFlowEditorStore((s) => s.updateNodeData);
  const storeNodes = useFlowEditorStore((s) => s.nodes);

  const node = useMemo(() => {
    if (!nodeId) {
      return null;
    }
    return storeNodes.find((n) => n.id === nodeId) ?? null;
  }, [nodeId, storeNodes]);

  const nodeData = node?.data as ReactFlowNodeData | undefined;
  const nodeType = nodeData?.type ?? 'core.template_string';
  const nodeParams = nodeData?.params ?? {};
  const definition = node ? getNodeDefinition(nodeType) : undefined;

  const handleResolvedParams = useCallback(
    (nid: string, params: Record<string, unknown>) => {
      updateNodeDataInStore(nid, { params } as Partial<ReactFlowNodeData>);
    },
    [updateNodeDataInStore],
  );

  const {
    definition: activeDefinition,
    values: formValues,
    warnings: configWarnings,
    errors: configErrors,
    updateField,
    isUpdating: isConfigUpdating,
  } = useNodeConfigState({
    node: node ?? null,
    nodeType,
    definition,
    onParamsChange: handleResolvedParams,
  });

  const flowActions = useFlowActions();
  const executeFlowToNodeMutation = useExecuteFlowToNode();
  const testNodeMutation = useTestNode();
  const testMapperMutation = useTestMapper();

  const upstream = useUpstreamSlots({ nodeId, flowId });
  const previewState = usePreviewState({ nodeId, updateNodeData: updateNodeDataInStore });

  // --- Extracted hooks ---
  const handleFieldChange = useCallback(
    (fieldName: string, value: unknown) => {
      if (!nodeId) {
        return;
      }
      const currentNode = storeNodes.find((n) => n.id === nodeId);
      const currentParams = (currentNode?.data as ReactFlowNodeData | undefined)?.params ?? {};
      const newParams = { ...currentParams, [fieldName]: value } as ReactFlowNodeData['params'];
      updateNodeDataInStore(nodeId, { params: newParams });
      updateField(fieldName, value);
    },
    [nodeId, updateNodeDataInStore, updateField, storeNodes],
  );

  const credentialHooks = useNodeCredentials({ enabled: open, onFieldChange: handleFieldChange });

  const currentNodeRequiredScopes = useMemo(() => {
    const credField = (activeDefinition?.paramFields ?? []).find(
      (f) => f.type === 'credential' && f.requiredScopes?.length,
    );
    return credField?.requiredScopes;
  }, [activeDefinition]);

  const oauthHooks = useOAuth2Refresh({ requiredScopes: currentNodeRequiredScopes });

  const agentToolsProps = useAgentToolManagement({
    nodeId,
    nodeType,
    nodeParams: nodeParams as Record<string, unknown>,
    storeNodes,
    updateNodeData: updateNodeDataInStore,
    availableTools,
    initialToolInstanceId,
  });

  // Mapper config
  const mapperConfig = (nodeData as Record<string, unknown> | undefined)?.mapper as
    | {
        enabled: boolean;
        expression: string;
        mode: 'auto' | 'iterate' | 'reshape';
        outputMode: 'array' | 'object' | 'first' | 'last' | 'concat';
        keyField?: string;
        concurrency: number;
        onEmpty: 'skip' | 'error';
      }
    | undefined;

  const handleMapperChange = useCallback(
    (config: typeof mapperConfig) => {
      if (!nodeId) {
        return;
      }
      updateNodeDataInStore(nodeId, { mapper: config } as Partial<ReactFlowNodeData>);
    },
    [nodeId, updateNodeDataInStore],
  );

  const parsedInputData = useMemo(() => {
    const raw = upstream.slots.length > 0 ? upstream.inputPreviewJson : previewState.inputPreview;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }, [upstream.slots.length, upstream.inputPreviewJson, previewState.inputPreview]);

  const handleTestMapper = useCallback(
    (request: {
      expression: string;
      incomingData: Record<string, unknown>;
      mode?: 'auto' | 'iterate' | 'reshape';
    }) => {
      testMapperMutation.mutate(request);
    },
    [testMapperMutation],
  );

  // Node execution
  const execution = useNodeExecution({
    nodeId,
    flowId,
    nodeType,
    nodeParams: nodeParams as Record<string, unknown>,
    executeFlowToNodeMutation,
    testNodeMutation,
    flowActions,
    updateNodeData: updateNodeDataInStore,
    isTestMode: previewState.isTestMode,
    inputPreview: previewState.inputPreview,
    onExecutionComplete: useCallback(
      (newInput: string, newOutput: string) => {
        previewState.updateFromExecution(newInput, newOutput);
      },
      [previewState],
    ),
  });

  // Derived display values
  const displayName = (nodeData?.display_name as string) || definition?.label || 'Untitled Node';
  const Icon = useMemo(
    () => getIconComponent(activeDefinition?.icon || definition?.icon),
    [activeDefinition?.icon, definition?.icon],
  );
  const categoryColor = 'bg-primary text-primary-foreground';
  const nodeTypeLabel = useMemo(() => formatNodeTypeLabel(nodeType), [nodeType]);

  const modelStatusMessage = useMemo(() => {
    if (nodeType !== 'core.model') {
      return '';
    }
    const selectedCredentialId = (formValues.credentialId as string) || '';
    const providerLabel =
      typeof formValues.provider === 'string' ? (formValues.provider as string) : '';
    const visibleFields = (activeDefinition?.paramFields || []).filter((f) => !f.hidden);
    const modelField = visibleFields.find((f) => f.name === 'model');
    if (!selectedCredentialId) {
      return 'Select a credential to load provider-specific models.';
    }
    if (isConfigUpdating) {
      return 'Updating configuration...';
    }
    if (configErrors.length) {
      return configErrors[0];
    }
    if (!providerLabel) {
      return 'Detecting provider from credential...';
    }
    if (modelField?.disabled) {
      return `No models available for provider ${providerLabel}.`;
    }
    return `Detected provider: ${providerLabel}`;
  }, [nodeType, formValues, activeDefinition, isConfigUpdating, configErrors]);

  // Handlers
  const handleLabelChange = useCallback(
    (newLabel: string) => {
      if (!nodeId) {
        return;
      }
      const allNodes = storeNodes;
      const referenceId = updateReferenceIdForDisplayName(newLabel, nodeId, allNodes);
      updateNodeDataInStore(nodeId, { display_name: newLabel, reference_id: referenceId });
    },
    [nodeId, updateNodeDataInStore, storeNodes],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          container={portalContainer}
          showCloseButton={false}
          className={cn(
            'h-[90vh] max-h-[90vh] overflow-hidden flex flex-col p-0 bg-card border-border',
            'sm:max-w-[95vw] w-[95vw]',
          )}
        >
          <DialogTitle className="sr-only">Configure {displayName} node</DialogTitle>
          <DialogDescription className="sr-only">
            Review node inputs, mapper settings, configuration, and output preview for the
            {` ${displayName} `}
            node.
          </DialogDescription>
          {node ? (
            <>
              <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 gap-0">
                <InputPanel
                  value={
                    upstream.slots.length > 0
                      ? upstream.inputPreviewJson
                      : previewState.inputPreview
                  }
                  onChange={previewState.handleInputPreviewChange}
                  error={previewState.inputError}
                  isTestMode={previewState.isTestMode}
                  onReset={previewState.handleResetTestMode}
                  upstreamSlots={upstream.slots}
                  onRunSlot={upstream.runSlot}
                  onRunAll={upstream.runAllUnresolved}
                  unresolvedCount={upstream.unresolvedCount}
                  isAnyLoading={upstream.isAnyLoading}
                  mapperValue={mapperConfig}
                  onMapperChange={handleMapperChange}
                  mapperAvailableVariables={upstream.upstreamVariables}
                  onTestMapper={handleTestMapper}
                  mapperPreviewResult={testMapperMutation.data ?? null}
                  isTestingMapper={testMapperMutation.isPending}
                  mapperInputData={parsedInputData}
                  portalContainer={portalContainer}
                />

                <ResizableHandle withHandle />

                <ConfigurationPanel
                  definition={activeDefinition}
                  formValues={formValues}
                  onFieldChange={handleFieldChange}
                  credentials={credentialHooks.credentials}
                  credentialsLoading={credentialHooks.credentialsLoading}
                  credentialsError={credentialHooks.credentialsError}
                  onRefreshCredentials={() => credentialHooks.refetchCredentials()}
                  onAddNewCredential={credentialHooks.handleAddNewCredential}
                  onEditCredential={credentialHooks.handleEditCredential}
                  onRefreshOAuthCredential={oauthHooks.handleRefreshOAuthCredential}
                  refreshingCredentialId={oauthHooks.refreshingCredentialId}
                  configWarnings={configWarnings}
                  configErrors={configErrors}
                  runError={execution.runError}
                  fieldErrors={execution.fieldErrors ?? undefined}
                  nodeType={nodeType}
                  modelStatusMessage={modelStatusMessage}
                  portalContainer={portalContainer}
                  upstreamVariables={upstream.upstreamVariables}
                  inputData={parsedInputData}
                  headerLabel={displayName}
                  onHeaderLabelChange={handleLabelChange}
                  headerNodeTypeLabel={nodeTypeLabel}
                  HeaderIcon={Icon}
                  headerCategoryColor={categoryColor}
                  onRunNode={execution.runNode}
                  isRunning={execution.isRunning}
                  agentTools={agentToolsProps}
                />

                <ResizableHandle withHandle />

                <OutputPanel
                  value={previewState.outputPreview}
                  onChange={previewState.handleOutputPreviewChange}
                  error={execution.outputError}
                />
              </ResizablePanelGroup>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Select a node to configure.</div>
          )}
          <DialogClose className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full bg-foreground/10 hover:bg-foreground/15 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-foreground/70 hover:text-foreground transition-colors shadow-md">
            <X className="w-3.5 h-3.5" />
            Close
          </DialogClose>
        </DialogContent>
      </Dialog>

      <CreateCredentialModal
        open={credentialHooks.isCreateCredentialOpen}
        onClose={credentialHooks.handleCloseCredentialModal}
        onSubmit={credentialHooks.handleCreateCredential}
        isLoading={credentialHooks.isCreating}
        portalContainer={portalContainer}
      />

      {credentialHooks.editingCredential && (
        <EditCredentialModal
          credential={credentialHooks.editingCredential}
          open={true}
          onClose={credentialHooks.handleCloseEditCredential}
          onSubmit={credentialHooks.handleUpdateCredential}
          isLoading={credentialHooks.isUpdating}
        />
      )}
    </>
  );
}
