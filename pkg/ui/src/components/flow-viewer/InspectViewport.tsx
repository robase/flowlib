import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';
import { FlowBottomToolbar } from '../flow-editor/FlowBottomToolbar';
import { RunControls } from '../flow-editor/RunControls';
import { FlowStatusView } from './FlowStatusView';
import { LogsPanel } from './logs-panel';
import { useFlowRun, useNodeExecutions } from '../../api/executions.api';
import { useFlowReactFlowData } from '../../api/flows.api';
import { useExecutionLogData, type SelectedExecutionAttempt } from './use-execution-log-data';
import { useFlowActions } from '../../routes/flow-route-layout';

export interface InspectViewportProps {
  flowId: string;
  flowVersion?: string;
  basePath?: string;
  /** The run id being inspected (from URL). */
  runId: string;
}

/**
 * Read-only run inspection viewport. Embedded inside FlowEditor when the
 * user navigates to a run from the sidebar — same shell, different canvas
 * + expanded logs. Owns its own focus / attempt-selection state so it's
 * fully self-contained.
 */
export function InspectViewport({
  flowId,
  flowVersion,
  basePath = '',
  runId,
}: InspectViewportProps) {
  const navigate = useNavigate();
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const [selectedAttempt, setSelectedAttempt] = useState<SelectedExecutionAttempt | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // SSE stream is subscribed by the parent (FlowEditor) so it shares one
  // connection across the whole route — no need to subscribe again here.
  const { data: selectedRun } = useFlowRun(runId);
  const { data: nodeExecutionsData, isLoading: nodeExecutionsLoading } = useNodeExecutions(runId);
  const nodeExecutions = nodeExecutionsData ?? [];

  // Fetches the graph snapshot for this run (with execution status baked in
  // by the backend). FlowStatusView reads its own data internally so we
  // mainly use this for the logs assembly below.
  const { data: flowGraphData } = useFlowReactFlowData(flowId, {
    version: flowVersion,
    flowRunId: runId,
  });

  const { nodes: executionLogNodes } = useExecutionLogData({
    nodes: flowGraphData?.nodes,
    nodeExecutions,
  });

  // Auto-select first attempt when nodes load.
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

  const handleEditNode = (nodeId: string) => {
    const editPath = flowVersion
      ? `${basePath}/flow/${flowId}/version/${flowVersion}`
      : `${basePath}/flow/${flowId}`;
    const params = new URLSearchParams();
    params.set('openNode', nodeId);
    params.set('fromRunId', runId);
    navigate(`${editPath}?${params.toString()}`);
  };

  const handleNodeClick = (nodeId: string) => {
    const nodeMatch = executionLogNodes.find((node) => node.nodeId === nodeId);

    if (nodeMatch && nodeMatch.attempts.length > 0) {
      const lastAttempt = nodeMatch.attempts[nodeMatch.attempts.length - 1];
      setSelectedAttempt({ nodeId: nodeMatch.nodeId, attemptId: lastAttempt.id });
      setFocusNodeId(nodeMatch.nodeId);
      if (!isLogsExpanded) {
        setIsLogsExpanded(true);
      }
    } else if (nodeMatch) {
      setSelectedAttempt({ nodeId: nodeMatch.nodeId, attemptId: '' });
      setFocusNodeId(nodeMatch.nodeId);
      if (!isLogsExpanded) {
        setIsLogsExpanded(true);
      }
    }
  };

  const handleSelectAttempt = (attempt: SelectedExecutionAttempt) => {
    setSelectedAttempt(attempt);
    setFocusNodeId(attempt.nodeId);
  };

  const flowActions = useFlowActions();

  return (
    <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
      <ResizablePanel defaultSize={55} minSize={20}>
        <div className="relative h-full">
          <FlowStatusView
            flowId={flowId}
            flowVersion={flowVersion}
            basePath={basePath}
            selectedRunId={runId}
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
      {isLogsExpanded ? (
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
              loading={nodeExecutionsLoading && !!runId}
              onToggle={() => setIsLogsExpanded(!isLogsExpanded)}
            />
          </ResizablePanel>
        </>
      ) : (
        <div className="shrink-0">
          <LogsPanel
            nodes={executionLogNodes}
            selectedAttempt={selectedAttempt}
            onSelectAttempt={handleSelectAttempt}
            isExpanded={isLogsExpanded}
            loading={nodeExecutionsLoading && !!runId}
            onToggle={() => setIsLogsExpanded(!isLogsExpanded)}
          />
        </div>
      )}
    </ResizablePanelGroup>
  );
}
