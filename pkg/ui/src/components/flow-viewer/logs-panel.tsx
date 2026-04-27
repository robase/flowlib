'use client';

import { useRef, useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Terminal,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Bot,
  Wrench,
  Expand,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { cn } from '~/lib/utils';
import {
  ExecutionLogNode,
  ExecutionLogAttempt,
  ExecutionLogToolCall,
  SelectedExecutionAttempt,
} from './use-execution-log-data';
import { NodeErrorBadge } from '../flow-editor/NodeErrorBadge';
import { NodeExecutionStatus } from '@flowlib/core/types';
import {
  CodeMirrorJsonEditor,
  type CodeMirrorJsonEditorHandle,
} from '../ui/codemirror-json-editor';
import { RunSelector, RunSelectorItem } from './RunSelector';

interface LogsPanelProps {
  nodes: ExecutionLogNode[];
  selectedAttempt: SelectedExecutionAttempt | null;
  onSelectAttempt: (next: SelectedExecutionAttempt) => void;
  isExpanded: boolean;
  onToggle: () => void;
  loading?: boolean;
  /** Runs list for the run selector dropdown */
  runs?: RunSelectorItem[];
  /** Currently selected run ID */
  selectedRunId?: string | null;
  /** Callback when a run is selected from the dropdown */
  onSelectRun?: (runId: string) => void;
}

function StatusIcon({ status, size = 14 }: { status: NodeExecutionStatus; size?: number }) {
  switch (status) {
    case NodeExecutionStatus.SUCCESS:
      return <CheckCircle2 className="flex-shrink-0 text-green-500" size={size} />;
    case NodeExecutionStatus.FAILED:
      return <XCircle className="flex-shrink-0 text-red-500" size={size} />;
    case NodeExecutionStatus.RUNNING:
      return (
        <div className="flex items-center justify-center" style={{ width: size, height: size }}>
          <div
            className="border-2 border-blue-500 rounded-full border-t-transparent animate-spin"
            style={{ width: size, height: size }}
          />
        </div>
      );
    case NodeExecutionStatus.PENDING:
      return <Clock className="flex-shrink-0 text-muted-foreground" size={size} />;
    case NodeExecutionStatus.SKIPPED:
      return <AlertCircle className="flex-shrink-0 text-yellow-500" size={size} />;
    case NodeExecutionStatus.BATCH_SUBMITTED:
      return <RefreshCw className="flex-shrink-0 text-amber-500" size={size} />;
    default:
      return <Clock className="flex-shrink-0 text-muted-foreground" size={size} />;
  }
}

function ToolStatusIcon({ success, size = 12 }: { success: boolean; size?: number }) {
  if (success) {
    return <CheckCircle2 className="flex-shrink-0 text-green-500" size={size} />;
  }
  return <XCircle className="flex-shrink-0 text-red-500" size={size} />;
}

const formatTimestamp = (value?: string) => {
  if (!value) {
    return '—';
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const formatDuration = (value?: number) => {
  if (value === undefined) {
    return '—';
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
};

const hasData = (value?: Record<string, unknown>) => value && Object.keys(value).length > 0;

export function LogsPanel({
  nodes,
  selectedAttempt,
  onSelectAttempt,
  isExpanded,
  onToggle,
  loading,
  runs,
  selectedRunId,
  onSelectRun,
}: LogsPanelProps) {
  const selectedNode = nodes.find((node) => node.nodeId === selectedAttempt?.nodeId) ?? nodes[0];
  const selectedAttemptData =
    selectedNode?.attempts.find((attempt) => attempt.id === selectedAttempt?.attemptId) ??
    selectedNode?.attempts[selectedNode?.attempts.length - 1];

  // Find selected tool call if any
  const selectedToolCall = selectedAttempt?.toolCallId
    ? selectedAttemptData?.toolCalls?.find((t) => t.id === selectedAttempt.toolCallId)
    : null;

  const handleSelectNode = (nodeId: string, attemptId: string) => {
    onSelectAttempt({ nodeId, attemptId, toolCallId: undefined });
  };

  const handleSelectTool = (nodeId: string, attemptId: string, toolCallId: string) => {
    onSelectAttempt({ nodeId, attemptId, toolCallId });
  };

  return (
    <div
      className={cn(
        'border-t border-border bg-imp-background text-card-foreground flex flex-col',
        isExpanded ? 'h-full' : 'h-8',
      )}
    >
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-1 transition-colors cursor-pointer hover:bg-accent/50 shrink-0"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Execution Logs</span>
          <Badge variant="secondary" className="text-xs">
            {loading ? 'Loading…' : `${nodes.length} nodes`}
          </Badge>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="flex flex-1 min-h-0 border-t border-border">
          <div className="imp-page border-r border-imp-border bg-imp-background text-imp-foreground w-[280px] shrink-0 flex flex-col">
            {runs && onSelectRun && (
              <div className="px-2 pt-2 pb-1 shrink-0">
                <RunSelector
                  runs={runs}
                  selectedRunId={selectedRunId ?? null}
                  onSelectRun={onSelectRun}
                />
              </div>
            )}
            <ScrollArea className="h-full min-h-0">
              <div className="p-2 space-y-2">
                {loading && nodes.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    Loading node executions…
                  </div>
                )}
                {!loading && nodes.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No nodes available for this flow.
                  </div>
                )}
                {nodes.map((node) => {
                  const latestAttempt = node.attempts[node.attempts.length - 1];
                  const nodeSelected =
                    selectedAttempt?.nodeId === node.nodeId && !selectedAttempt?.toolCallId;
                  const isAgentNode = node.nodeType === 'core.agent';
                  const toolCalls = latestAttempt.toolCalls ?? [];
                  return (
                    <div
                      key={node.nodeId}
                      className="border rounded-lg border-border/60 bg-card/40"
                    >
                      <button
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                          nodeSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
                        )}
                        onClick={() => handleSelectNode(node.nodeId, latestAttempt.id)}
                      >
                        <StatusIcon status={latestAttempt.status} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate flex items-center gap-1.5">
                            {isAgentNode && (
                              <Bot className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            )}
                            {node.nodeName}
                          </div>
                          <div className="text-xs truncate text-muted-foreground">
                            {latestAttempt.label}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(latestAttempt.durationMs)}
                        </span>
                      </button>

                      {/* Nested tool calls for agent nodes */}
                      {isAgentNode && toolCalls.length > 0 && (
                        <div className="border-t border-border/60 bg-muted/20">
                          {toolCalls.map((tool) => {
                            const toolSelected =
                              selectedAttempt?.nodeId === node.nodeId &&
                              selectedAttempt?.toolCallId === tool.id;
                            return (
                              <button
                                key={tool.id}
                                onClick={() =>
                                  handleSelectTool(node.nodeId, latestAttempt.id, tool.id)
                                }
                                className={cn(
                                  'flex w-full items-center gap-2 pl-6 pr-3 py-1.5 text-left text-xs transition-colors',
                                  toolSelected
                                    ? 'bg-accent/60 text-accent-foreground'
                                    : 'hover:bg-accent/30',
                                )}
                              >
                                <Wrench className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <ToolStatusIcon success={tool.success} size={10} />
                                <span className="flex-1 truncate">{tool.toolName}</span>
                                <span className="text-muted-foreground">
                                  {formatDuration(tool.executionTimeMs)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Multiple attempts (retries) */}
                      {node.attempts.length > 1 && (
                        <div className="border-t border-border/60">
                          {node.attempts.map((attempt) => {
                            const attemptSelected =
                              selectedAttempt?.nodeId === node.nodeId &&
                              selectedAttempt?.attemptId === attempt.id &&
                              !selectedAttempt?.toolCallId;
                            return (
                              <button
                                key={attempt.id}
                                onClick={() => handleSelectNode(node.nodeId, attempt.id)}
                                className={cn(
                                  'flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition-colors',
                                  attemptSelected
                                    ? 'bg-accent/60 text-accent-foreground'
                                    : 'hover:bg-accent/30',
                                )}
                              >
                                <StatusIcon status={attempt.status} size={12} />
                                <span className="flex-1 truncate">{attempt.label}</span>
                                <span className="text-muted-foreground">
                                  {formatDuration(attempt.durationMs)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="flex-1 min-w-0 overflow-hidden bg-imp-background text-imp-foreground">
            <ScrollArea className="h-full">
              {/* Tool Call Detail View */}
              {selectedToolCall ? (
                <ToolCallDetailView tool={selectedToolCall} />
              ) : selectedAttemptData ? (
                <NodeAttemptDetailView
                  nodeName={selectedNode?.nodeName ?? ''}
                  attempt={selectedAttemptData}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  {loading
                    ? 'Waiting for node executions…'
                    : 'Select a node attempt to view details.'}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Detail view for a selected tool call
 */
function ToolCallDetailView({ tool }: { tool: ExecutionLogToolCall }) {
  const [inputOpen, setInputOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);

  return (
    <div className="max-w-full">
      <div className="sticky top-0 z-10 bg-imp-background px-4 py-2 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold flex items-center gap-2">
              {tool.toolName}
              <ToolStatusIcon success={tool.success} size={14} />
            </span>
            <span className="text-xs text-muted-foreground">Iteration {tool.iteration}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground/70">Duration</span>{' '}
              {formatDuration(tool.executionTimeMs)}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Input */}
        <div className="max-w-full overflow-hidden">
          <button
            type="button"
            onClick={() => setInputOpen(!inputOpen)}
            className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
          >
            {inputOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            Input
          </button>
          {inputOpen && (
            <div className="max-w-full overflow-hidden border rounded-md border-border">
              <CodeMirrorJsonEditor
                value={JSON.stringify(tool.input, null, 2)}
                readOnly
                disableLinting
                minHeight="60px"
                className="max-w-full"
              />
            </div>
          )}
        </div>

        {/* Output */}
        {tool.output !== undefined && (
          <div className="max-w-full overflow-hidden">
            <button
              type="button"
              onClick={() => setOutputOpen(!outputOpen)}
              className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
            >
              {outputOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Output
            </button>
            {outputOpen && (
              <div className="max-w-full overflow-hidden border rounded-md border-border">
                <CodeMirrorJsonEditor
                  value={JSON.stringify(tool.output, null, 2)}
                  readOnly
                  disableLinting
                  minHeight="60px"
                  className="max-w-full"
                />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {tool.error && (
          <div>
            <div className="mb-2 text-sm font-semibold text-red-500">Error</div>
            <pre className="p-3 text-sm font-mono text-red-500 border rounded-md bg-red-500/10 border-red-500/20 whitespace-pre-wrap break-words max-h-60 overflow-auto">
              {tool.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Detail view for a selected node attempt
 */
function NodeAttemptDetailView({
  nodeName,
  attempt,
}: {
  nodeName: string;
  attempt: ExecutionLogAttempt;
}) {
  const [inputsOpen, setInputsOpen] = useState(true);
  const [outputsOpen, setOutputsOpen] = useState(true);
  const inputsEditorRef = useRef<CodeMirrorJsonEditorHandle | null>(null);
  const outputsEditorRef = useRef<CodeMirrorJsonEditorHandle | null>(null);

  return (
    <div className="max-w-full">
      <div className="sticky top-0 z-10 bg-imp-background px-4 py-2 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <StatusIcon status={attempt.status} size={16} />
            <span className="text-sm font-semibold">{nodeName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground/70">Started</span>{' '}
              {formatTimestamp(attempt.startedAt)}
            </span>
            <span>
              <span className="text-foreground/70">Duration</span>{' '}
              {formatDuration(attempt.durationMs)}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Agent Summary */}
        {attempt.agentMetadata && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border/60">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Agent Summary</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Model:</span>{' '}
                <span className="text-foreground font-medium">
                  {attempt.agentMetadata.model ?? 'Unknown'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Iterations:</span>{' '}
                <span className="text-foreground font-medium">
                  {attempt.agentMetadata.iterations}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Tools Used:</span>{' '}
                <span className="text-foreground font-medium">
                  {attempt.toolCalls?.length ?? 0}
                </span>
              </div>
              {attempt.agentMetadata.tokenUsage && (
                <div>
                  <span className="text-muted-foreground">Tokens:</span>{' '}
                  <span className="text-foreground font-medium">
                    ~{attempt.agentMetadata.tokenUsage.conversationTokensEstimate.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
            {attempt.agentMetadata.finalResponse && (
              <div className="mt-3 pt-3 border-t border-border/60">
                <div className="text-xs font-medium text-muted-foreground mb-1">Final Response</div>
                <div className="text-sm text-foreground whitespace-pre-wrap">
                  {attempt.agentMetadata.finalResponse}
                </div>
              </div>
            )}
          </div>
        )}

        {hasData(attempt.inputs) && (
          <div className="max-w-full overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-2">
              <button
                type="button"
                onClick={() => setInputsOpen(!inputsOpen)}
                className="flex items-center gap-1.5 text-sm font-semibold text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
              >
                {inputsOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {attempt.isLoopIteration ? 'Iteration Input' : 'Inputs'}
              </button>
              {inputsOpen && (
                <button
                  type="button"
                  onClick={() => inputsEditorRef.current?.expandAll()}
                  title="Expand all collapsed sections"
                  aria-label="Expand all"
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  <Expand className="size-3.5" />
                </button>
              )}
            </div>
            {inputsOpen && (
              <div className="max-w-full overflow-hidden border rounded-md border-border">
                <CodeMirrorJsonEditor
                  ref={inputsEditorRef}
                  value={JSON.stringify(
                    attempt.isLoopIteration && attempt.iterationItem
                      ? attempt.iterationItem.value
                      : attempt.inputs,
                    null,
                    2,
                  )}
                  readOnly
                  disableLinting
                  autoFoldDeep
                  minHeight="60px"
                  className="max-w-full"
                />
              </div>
            )}
          </div>
        )}

        {attempt.outputs && (
          <div className="max-w-full overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-2">
              <button
                type="button"
                onClick={() => setOutputsOpen(!outputsOpen)}
                className="flex items-center gap-1.5 text-sm font-semibold text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
              >
                {outputsOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                Outputs
              </button>
              {outputsOpen && (
                <button
                  type="button"
                  onClick={() => outputsEditorRef.current?.expandAll()}
                  title="Expand all collapsed sections"
                  aria-label="Expand all"
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  <Expand className="size-3.5" />
                </button>
              )}
            </div>
            {outputsOpen && (
              <div className="max-w-full overflow-hidden border rounded-md border-border">
                <CodeMirrorJsonEditor
                  ref={outputsEditorRef}
                  value={JSON.stringify(attempt.outputs, null, 2)}
                  readOnly
                  disableLinting
                  autoFoldDeep
                  minHeight="60px"
                  className="max-w-full"
                />
              </div>
            )}
          </div>
        )}

        {attempt.error && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-500">
              <span>Error</span>
              {attempt.errorDetails ? <NodeErrorBadge details={attempt.errorDetails} /> : null}
            </div>
            <pre className="p-3 text-sm font-mono text-red-500 border rounded-md bg-red-500/10 border-red-500/20 whitespace-pre-wrap break-words max-h-60 overflow-auto">
              {attempt.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
