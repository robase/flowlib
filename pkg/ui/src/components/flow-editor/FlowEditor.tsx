import React, { useRef, useCallback, useState, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { FlowLayout } from './FlowLayout';
import { RunControls } from './RunControls';
import { FlowWorkbenchView } from './FlowWorkbenchView';
import { InspectViewport } from '../flow-viewer/InspectViewport';
import { NodeSidebar } from './NodeSidebar';
import { EditorSidebar, createNodesSection, createRunsSection } from './sidebar';
import { FlowBottomToolbar } from './FlowBottomToolbar';
import { ValidationPanel } from './ValidationPanel';
import { ToolConfigPanel } from './ToolConfigPanel';
import { ChatPanel, ChatToggleButton, ChatPromptOverlay } from '~/components/chat';
import { ViewCodeToggleButton } from './ViewCodeToggleButton';
import { FlowCodePanel } from './FlowCodePanel';
import { useFlowEditorStore } from './flow-editor.store';
import { useFlowReactFlowData } from '../../api/flows.api';
import { useNodeExecutions } from '../../api/executions.api';
import { useFlowRunStream } from '../../api/use-flow-run-stream';
import type { NodeExecutionStatus, ReactFlowNode } from '@flowlib/core/types';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import { LogsPanel } from '../flow-viewer/logs-panel';
import {
  useExecutionLogData,
  type SelectedExecutionAttempt,
} from '../flow-viewer/use-execution-log-data';
import { useFlowActions } from '../../routes/flow-route-layout';
import { useUIStore } from '~/stores/uiStore';
import { Skeleton } from '../ui/skeleton';
import { useToolPanel } from './use-tool-panel';

export interface FlowEditorProps {
  flowId: string;
  flowVersion?: string;
  basePath?: string;
  initialName?: string;
}

// Route-level shell. Owns view-mode decisions (edit / edit-live / inspect),
// the SSE subscription, the bottom logs panel state for edit-live, and the
// sidebar + right-panel JSX. The actual canvas (React Flow) lives in
// FlowWorkbenchView, which is mounted in edit and edit-live modes.
export function FlowEditor({ flowId, flowVersion, basePath = '' }: FlowEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const addNodeFnRef = useRef<(type: string) => void>(() => {
    // Default implementation
  });
  const [showValidation] = useState(false);
  const [layoutSelector, setLayoutSelector] = useState<React.ReactNode>(null);

  const { isLoading: loading, error: queryError } = useFlowReactFlowData(flowId, {
    version: flowVersion,
  });

  // Sidebar visibility (persisted across the app)
  const nodeSidebarOpen = useUIStore((s) => s.nodeSidebarOpen);
  const toggleNodeSidebar = useUIStore((s) => s.toggleNodeSidebar);

  // Flow actions from parent layout context (execute, active state)
  const flowActions = useFlowActions();

  // Inspect mode is signalled by the URL path containing `/runs`. The sidebar's
  // RunsSection navigates there on click; the Run button stays on the editor
  // path (edit-live). Both modes share this single shell — no Edit/Runs tab.
  const location = useLocation();
  const isInspectRoute = location.pathname.includes('/runs');

  const handleRegisterAddNode = useCallback((fn: (type: string) => void) => {
    addNodeFnRef.current = fn;
  }, []);

  const handleAddNode = useCallback((type: string) => {
    addNodeFnRef.current(type);
  }, []);

  // Consume `?addNode=<type>` set by NodesSection when clicked from inspect
  // mode. The sidebar can't add directly there because FlowWorkbenchView (and
  // therefore the registered add handler) isn't mounted; bouncing through this
  // param lets us land in edit mode and add on arrival.
  React.useEffect(() => {
    const addType = new URLSearchParams(location.search).get('addNode');
    if (!addType || isInspectRoute) {
      return;
    }
    // Defer one tick so FlowWorkbenchView's onRegisterAddNode effect has had a
    // chance to populate addNodeFnRef before we call into it.
    const id = setTimeout(() => {
      handleAddNode(addType);
      // Clear the param so a refresh doesn't re-add the node.
      const next = new URLSearchParams(location.search);
      next.delete('addNode');
      const search = next.toString();
      navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, isInspectRoute]);

  // Tool panel state (agent tool selection, tool config).
  // Lifted here so the sidebar + right panel can be rendered directly in this
  // component's JSX rather than pushed up via render-prop callbacks from the
  // canvas. FlowWorkbenchView receives the API as a single `toolPanel` prop.
  const toolPanel = useToolPanel();

  // --- Edit-live: read ?runId=, subscribe to SSE, build node-status map ---
  const [searchParams, setSearchParams] = useSearchParams();
  const liveRunId = searchParams.get('runId');
  useFlowRunStream(flowId, liveRunId);
  const { data: liveNodeExecutions, isLoading: liveExecutionsLoading } = useNodeExecutions(
    liveRunId ?? '',
  );

  const liveStatusByNodeId = useMemo(() => {
    const map = new Map<string, NodeExecutionStatus>();
    if (!liveRunId || !liveNodeExecutions) {
      return map;
    }
    for (const exec of liveNodeExecutions) {
      // Latest attempt wins (API returns executions in chronological order).
      map.set(exec.nodeId, exec.status);
    }
    return map;
  }, [liveRunId, liveNodeExecutions]);

  // --- Edit-live bottom logs panel state ---
  const liveStoreNodes = useFlowEditorStore((s) => s.nodes);
  const { nodes: executionLogNodes } = useExecutionLogData({
    nodes: liveStoreNodes as ReactFlowNode[],
    nodeExecutions: liveNodeExecutions ?? [],
  });
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<SelectedExecutionAttempt | null>(null);

  const handleExitLiveRun = useCallback(() => {
    // From inspect (/flow/:id/runs?runId=X) we need a path change back to the
    // editor route too — just clearing the search param leaves us on /runs
    // which auto-selects the latest run.
    if (isInspectRoute) {
      navigate(`${basePath}/flow/${flowId}`);
    } else {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('runId');
          return next;
        },
        { replace: true },
      );
    }
    setIsLogsExpanded(false);
    setSelectedAttempt(null);
  }, [isInspectRoute, navigate, basePath, flowId, setSearchParams]);

  // Toolbar contents — rendered either by FlowLayout (plain edit) or inline
  // inside the canvas ResizablePanel (edit-live, so the toolbar floats above
  // the LogsPanel strip rather than overlapping it).
  const editorToolbarExtra = (
    <div className="flex items-center gap-1.5">
      {liveRunId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExitLiveRun}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          title="Exit run view"
        >
          <X className="w-3.5 h-3.5" />
          Exit run view
        </Button>
      )}
      <RunControls
        onExecute={flowActions?.onExecute}
        isExecuting={flowActions?.isExecuting}
        isActive={flowActions?.isActive}
        isTogglingActive={flowActions?.isTogglingActive}
        onToggleActive={flowActions?.onToggleActive}
      />
    </div>
  );

  // Sidebar — agent-actions mode swap based on toolPanel.sidebarMode. Both
  // modes share the same shell width and sidebar-open toggle.
  const sidebarElement =
    toolPanel.sidebarMode === 'actions' ? (
      <NodeSidebar
        mode="actions"
        onAddNode={handleAddNode}
        onCollapse={toggleNodeSidebar}
        onClose={toolPanel.handleCloseToolSelector}
        availableTools={toolPanel.availableTools}
        addedTools={toolPanel.currentNodeAddedTools}
        onAddTool={toolPanel.handleAddToolToNode}
        onRemoveTool={toolPanel.handleRemoveToolFromNode}
        onSelectTool={toolPanel.handleSelectToolInstance}
        selectedInstanceId={toolPanel.selectedToolInstanceId}
      />
    ) : (
      <EditorSidebar
        flowId={flowId}
        basePath={basePath}
        sections={[createNodesSection({ onAddNode: handleAddNode }), createRunsSection()]}
        onCollapse={toggleNodeSidebar}
      />
    );

  // Right panel — ToolConfigPanel when an agent-tool instance is selected.
  const rightPanelElement =
    toolPanel.toolConfigPanelOpen && toolPanel.selectedToolDef && toolPanel.selectedToolInstance ? (
      <ToolConfigPanel
        open={toolPanel.toolConfigPanelOpen}
        onClose={toolPanel.handleCloseToolConfig}
        tool={toolPanel.selectedToolDef}
        instance={toolPanel.selectedToolInstance}
        onUpdate={toolPanel.handleUpdateToolInNode}
        onRemove={toolPanel.handleRemoveToolFromNode}
      />
    ) : null;

  if (loading) {
    return (
      <div className="flex w-full h-full min-h-0">
        {/* Sidebar skeleton */}
        <div className="flex flex-col w-96 border-r border-border bg-fl-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-7 w-7" />
          </div>
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="flex-1 p-3 space-y-4">
            {Array.from({ length: 3 }).map((_, groupIdx) => (
              <div key={groupIdx} className="space-y-2">
                <Skeleton className="h-3 w-24 mb-2" />
                {Array.from({ length: 4 }).map((_, itemIdx) => (
                  <div key={itemIdx} className="flex items-center gap-2 px-2 py-1.5">
                    <Skeleton className="h-6 w-6 rounded shrink-0" />
                    <Skeleton className="h-3 flex-1 max-w-40" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* Canvas skeleton */}
        <div className="flex-1 relative bg-background">
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-8" />
          </div>
          {/* Faux node placeholders */}
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
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="p-4 text-red-800 border border-red-200 rounded bg-red-50">
          Error: {queryError.message}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex flex-col flex-1 min-h-0 bg-background text-foreground">
        <FlowLayout
          layoutSelector={layoutSelector}
          viewportRef={viewportRef}
          sidebar={sidebarElement}
          sidebarOpen={nodeSidebarOpen}
          onToggleSidebar={toggleNodeSidebar}
          rightPanel={rightPanelElement}
          chatToggle={<ChatToggleButton />}
          viewCodeToggle={<ViewCodeToggleButton />}
          chatPanel={<ChatPanel flowId={flowId} basePath={basePath} />}
          codePanel={<FlowCodePanel flowId={flowId} />}
          chatOverlay={<ChatPromptOverlay />}
          toolbarExtra={editorToolbarExtra}
          hideToolbar={Boolean(liveRunId)}
          viewport={
            isInspectRoute && liveRunId ? (
              // Inspect mode: read-only canvas + expanded logs.
              <InspectViewport
                flowId={flowId}
                flowVersion={flowVersion}
                basePath={basePath}
                runId={liveRunId}
              />
            ) : liveRunId ? (
              // Edit-live mode: editable canvas + collapsed logs by default.
              <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
                <ResizablePanel defaultSize={isLogsExpanded ? 60 : 100} minSize={20}>
                  {/* `relative h-full` anchors the FlowBottomToolbar to the
                      canvas region only, so the toolbar always sits above the
                      LogsPanel strip below. */}
                  <div className="relative h-full">
                    <FlowWorkbenchView
                      flowId={flowId}
                      basePath={basePath}
                      onRegisterAddNode={handleRegisterAddNode}
                      onLayoutSelectorRender={setLayoutSelector}
                      onAddNode={handleAddNode}
                      toolPanel={toolPanel}
                      liveRunId={liveRunId}
                      liveStatusByNodeId={liveStatusByNodeId}
                    />
                    <FlowBottomToolbar
                      layoutSelector={layoutSelector}
                      toolbarExtra={editorToolbarExtra}
                      sidebarOpen={nodeSidebarOpen}
                      onToggleSidebar={toggleNodeSidebar}
                    />
                  </div>
                </ResizablePanel>
                {isLogsExpanded ? (
                  <>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize={40} minSize={10}>
                      <LogsPanel
                        nodes={executionLogNodes}
                        selectedAttempt={selectedAttempt}
                        onSelectAttempt={setSelectedAttempt}
                        isExpanded={isLogsExpanded}
                        loading={liveExecutionsLoading}
                        onToggle={() => setIsLogsExpanded((v) => !v)}
                      />
                    </ResizablePanel>
                  </>
                ) : (
                  <div className="shrink-0">
                    <LogsPanel
                      nodes={executionLogNodes}
                      selectedAttempt={selectedAttempt}
                      onSelectAttempt={setSelectedAttempt}
                      isExpanded={isLogsExpanded}
                      loading={liveExecutionsLoading}
                      onToggle={() => setIsLogsExpanded((v) => !v)}
                    />
                  </div>
                )}
              </ResizablePanelGroup>
            ) : (
              // Plain edit mode.
              <FlowWorkbenchView
                flowId={flowId}
                basePath={basePath}
                onRegisterAddNode={handleRegisterAddNode}
                onLayoutSelectorRender={setLayoutSelector}
                onAddNode={handleAddNode}
                toolPanel={toolPanel}
                liveRunId={liveRunId}
                liveStatusByNodeId={liveStatusByNodeId}
              />
            )
          }
        />
      </div>

      {/* Validation panel slides in from right */}
      {showValidation && <ValidationPanel />}
    </div>
  );
}
