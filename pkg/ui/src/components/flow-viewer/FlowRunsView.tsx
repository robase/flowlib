import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FlowLayout } from '../flow-editor/FlowLayout';
import { FlowBottomToolbar } from '../flow-editor/FlowBottomToolbar';
import { ModeSwitcher } from '../flow-editor/ModeSwitcher';
import { RunControls } from '../flow-editor/RunControls';
import { FlowStatusView } from './FlowStatusView';
import { LogsPanel } from './logs-panel';
import { ChatPanel, ChatToggleButton } from '~/components/chat';
import { ViewCodeToggleButton } from '../flow-editor/ViewCodeToggleButton';
import { FlowCodePanel } from '../flow-editor/FlowCodePanel';
import { useFlowRuns, useFlowRun, useNodeExecutions } from '../../api/executions.api';
import { useFlowRunStream } from '../../api/use-flow-run-stream';
import { useFlowReactFlowData } from '../../api/flows.api';
import { FlowRun } from '@flowlib/core/types';
import { useExecutionLogData, SelectedExecutionAttempt } from './use-execution-log-data';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';
import { useFlowActions } from '../../routes/flow-route-layout';

export interface FlowRunsViewProps {
  flowId: string;
  flowVersion?: string;
  basePath?: string;
}

// Runs view shell - displays the flow execution history and status
export function FlowRunsView({ flowId, flowVersion, basePath }: FlowRunsViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Get runId from URL query parameter if present
  const urlRunId = searchParams.get('runId');

  const [selectedRunId, setSelectedRunId] = useState<string | null>(urlRunId);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const [selectedAttempt, setSelectedAttempt] = useState<SelectedExecutionAttempt | null>(null);
  // focusNodeId is only set when user explicitly clicks - not on auto-select
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // Fetch selected run first to get its status for polling
  const { data: selectedRun } = useFlowRun(selectedRunId || '');

  // SSE stream — pushes updates into React Query caches for the selected run,
  // eliminating the need for polling on useFlowRun, useFlowRuns, and useNodeExecutions.
  useFlowRunStream(flowId, selectedRunId);

  // Fetch runs list - uses cached data from the stream when available
  const { data: executionsResponse } = useFlowRuns(flowId);
  const runs = executionsResponse?.data ?? [];

  const { data: nodeExecutionsData, isLoading: nodeExecutionsLoading } = useNodeExecutions(
    selectedRunId || '',
  );

  // Fetch flow graph data with execution status — no longer polls; cache is
  // updated by the SSE stream for node executions, and we derive status locally.
  const { data: flowGraphData } = useFlowReactFlowData(flowId, {
    version: flowVersion,
    flowRunId: selectedRunId || undefined,
  });

  const nodeExecutions = nodeExecutionsData ?? [];

  const { nodes: executionLogNodes } = useExecutionLogData({
    nodes: flowGraphData?.nodes,
    nodeExecutions,
  });

  // Select run from URL param when it becomes available in the list, or fallback to latest
  useEffect(() => {
    // If we have a URL runId, wait for it to appear in the runs list
    if (urlRunId) {
      const runExists = runs.some((r) => r.id === urlRunId);
      if (runExists && selectedRunId !== urlRunId) {
        setSelectedRunId(urlRunId);
      }
      return;
    }

    // No URL param - auto-select latest run if none selected
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId, urlRunId]);

  useEffect(() => {
    if (!executionLogNodes.length) {
      if (selectedAttempt !== null) {
        setSelectedAttempt(null);
      }
      return;
    }

    if (selectedAttempt) {
      const nodeMatch = executionLogNodes.find((node) => node.nodeId === selectedAttempt.nodeId);
      const attemptExists = nodeMatch?.attempts.some(
        (attempt) => attempt.id === selectedAttempt.attemptId,
      );
      if (attemptExists) {
        return;
      }
    }

    const firstNodeWithAttempt = executionLogNodes.find((node) => node.attempts.length > 0);
    if (firstNodeWithAttempt) {
      const lastAttempt = firstNodeWithAttempt.attempts[firstNodeWithAttempt.attempts.length - 1];
      setSelectedAttempt({ nodeId: firstNodeWithAttempt.nodeId, attemptId: lastAttempt.id });
    } else {
      setSelectedAttempt(null);
    }
  }, [executionLogNodes, selectedAttempt]);

  const handleModeChange = (newMode: 'edit' | 'runs') => {
    if (newMode === 'edit') {
      // Always switch to the latest version on Edit. Pinning the
      // editor to a historical `flowVersion` (the version this run
      // executed against) would let the user accidentally edit an old
      // snapshot rather than the live definition; the runs view is the
      // place to inspect history, the editor is the place to change
      // the current flow.
      navigate(`${basePath}/flow/${flowId}`);
    }
  };

  // Navigate to editor and open the node config panel for the given node
  const handleEditNode = (nodeId: string) => {
    const editPath = flowVersion
      ? `${basePath}/flow/${flowId}/version/${flowVersion}`
      : `${basePath}/flow/${flowId}`;
    const params = new URLSearchParams();
    params.set('openNode', nodeId);
    if (selectedRunId) {
      params.set('fromRunId', selectedRunId);
    }
    navigate(`${editPath}?${params.toString()}`);
  };

  // Handle node click in the flow graph - expand logs and select the node
  const handleNodeClick = (nodeId: string) => {
    // Find the node in execution logs
    const nodeMatch = executionLogNodes.find((node) => node.nodeId === nodeId);

    if (nodeMatch && nodeMatch.attempts.length > 0) {
      // Select the latest attempt for this node
      const lastAttempt = nodeMatch.attempts[nodeMatch.attempts.length - 1];
      setSelectedAttempt({ nodeId: nodeMatch.nodeId, attemptId: lastAttempt.id });
      // Set focusNodeId to trigger centering (user-initiated)
      setFocusNodeId(nodeMatch.nodeId);

      // Expand the logs panel if not already expanded
      if (!isLogsExpanded) {
        setIsLogsExpanded(true);
      }
    } else if (nodeMatch) {
      // Node exists in logs but has no attempts - just expand and show node
      setSelectedAttempt({ nodeId: nodeMatch.nodeId, attemptId: '' });
      setFocusNodeId(nodeMatch.nodeId);
      if (!isLogsExpanded) {
        setIsLogsExpanded(true);
      }
    }
  };

  // Handle selection from logs panel - also triggers centering
  const handleSelectAttempt = (attempt: SelectedExecutionAttempt) => {
    setSelectedAttempt(attempt);
    // Set focusNodeId to trigger centering (user-initiated)
    setFocusNodeId(attempt.nodeId);
  };

  const runSelectorItems = runs.map((r: FlowRun) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  }));

  // Flow actions from parent layout context (execute, active state)
  const flowActions = useFlowActions();

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 imp-page bg-imp-background text-imp-foreground">
      <FlowLayout
        modeSwitcher={<ModeSwitcher mode="runs" onModeChange={handleModeChange} />}
        viewportRef={viewportRef}
        chatToggle={<ChatToggleButton />}
        viewCodeToggle={<ViewCodeToggleButton />}
        chatPanel={
          <ChatPanel
            flowId={flowId}
            basePath={basePath}
            selectedRunId={selectedRunId ?? undefined}
            viewMode="runs"
          />
        }
        codePanel={<FlowCodePanel flowId={flowId} source="version" />}
        sidebar={<></>}
        hideToolbar
        viewport={
          <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
            <ResizablePanel defaultSize={55} minSize={20}>
              <div className="relative h-full">
                <FlowStatusView
                  flowId={flowId}
                  flowVersion={flowVersion}
                  basePath={basePath}
                  selectedRunId={selectedRunId}
                  selectedRun={selectedRun}
                  logsExpanded={isLogsExpanded}
                  onNodeClick={handleNodeClick}
                  onEditNode={handleEditNode}
                  focusNodeId={focusNodeId}
                  onFocusComplete={() => setFocusNodeId(null)}
                  recenterTrigger={recenterTrigger}
                  selectedNodeId={selectedAttempt?.nodeId}
                />
                <FlowBottomToolbar
                  toolbarExtra={
                    <RunControls
                      onExecute={flowActions?.onExecute}
                      isExecuting={flowActions?.isExecuting}
                      isActive={flowActions?.isActive}
                      isTogglingActive={flowActions?.isTogglingActive}
                      onToggleActive={flowActions?.onToggleActive}
                    />
                  }
                />
              </div>
            </ResizablePanel>
            {isLogsExpanded && (
              <>
                <ResizableHandle
                  withHandle
                  onDragging={(isDragging) => {
                    if (!isDragging) {
                      setRecenterTrigger((c) => c + 1);
                    }
                  }}
                />
                <ResizablePanel defaultSize={45} minSize={10}>
                  <LogsPanel
                    nodes={executionLogNodes}
                    selectedAttempt={selectedAttempt}
                    onSelectAttempt={handleSelectAttempt}
                    isExpanded={isLogsExpanded}
                    loading={nodeExecutionsLoading && !!selectedRunId}
                    onToggle={() => setIsLogsExpanded(!isLogsExpanded)}
                    runs={runSelectorItems}
                    selectedRunId={selectedRunId}
                    onSelectRun={setSelectedRunId}
                  />
                </ResizablePanel>
              </>
            )}
            {!isLogsExpanded && (
              <div className="shrink-0">
                <LogsPanel
                  nodes={executionLogNodes}
                  selectedAttempt={selectedAttempt}
                  onSelectAttempt={handleSelectAttempt}
                  isExpanded={isLogsExpanded}
                  loading={nodeExecutionsLoading && !!selectedRunId}
                  onToggle={() => setIsLogsExpanded(!isLogsExpanded)}
                  runs={runSelectorItems}
                  selectedRunId={selectedRunId}
                  onSelectRun={setSelectedRunId}
                />
              </div>
            )}
          </ResizablePanelGroup>
        }
      />
    </div>
  );
}

export default FlowRunsView;
