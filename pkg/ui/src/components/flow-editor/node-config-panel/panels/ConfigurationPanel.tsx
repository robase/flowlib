import { useMemo, useState, useCallback } from 'react';
import { ResizablePanel } from '../../../ui/resizable';
import { ScrollArea } from '../../../ui/scroll-area';
import { CredentialsSection } from '../CredentialsSection';
import { ParametersSection } from '../ParametersSection';
import { InlineEdit } from '../../inline-edit';
import { Button } from '../../../ui/button';
import { Badge } from '../../../ui/badge';
import {
  Settings,
  Key,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Play,
  Wrench,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { AgentToolsPanel } from './AgentToolsPanel';
import type { AgentToolsPanelProps } from './AgentToolsPanel';
import type { Credential } from '../../../../api/types';
import type { NodeParamField } from '../../../../types/node-definition.types';

interface NodeDefinition {
  paramFields?: NodeParamField[];
}

/**
 * Compact error display for node execution errors in the config panel.
 * Shows a short summary — the full error is displayed in the Output panel.
 */
function ExecutionErrorDisplay({ error }: { error: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(error).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [error],
  );

  // Extract a short summary: first line, truncated
  const isLong = error.length > 150 || error.includes('\n');
  const summary = isLong ? error.split('\n')[0].slice(0, 140) + '…' : error;

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/5 border border-destructive/20">
      <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-xs text-destructive">
        <strong>Execution Error:</strong> {summary}
        {isLong && (
          <span className="text-destructive/60 ml-1">See full error in Output panel ↓</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 p-0.5 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors"
        title="Copy error"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

interface ConfigurationPanelProps {
  definition: NodeDefinition | undefined;
  formValues: Record<string, unknown>;
  onFieldChange: (fieldName: string, value: unknown) => void;
  credentials: Credential[];
  credentialsLoading: boolean;
  credentialsError: boolean;
  onRefreshCredentials: () => void;
  onAddNewCredential: (fieldName: string) => void;
  onEditCredential?: (credential: Credential) => void;
  onRefreshOAuthCredential?: (credential: Credential) => void;
  refreshingCredentialId?: string | null;
  configWarnings: string[];
  configErrors: string[];
  runError: string | null;
  /** Per-field validation errors keyed by field name (from execution errors). */
  fieldErrors?: Record<string, string>;
  nodeType: string;
  modelStatusMessage: string;
  portalContainer?: HTMLElement | null;
  /**
   * Available upstream node reference IDs for loop variable suggestions
   */
  upstreamVariables?: string[];
  /** Input data from upstream nodes — for autocomplete in code fields. */
  inputData?: Record<string, unknown>;
  /** Node header props — rendered as the panel header */
  headerLabel?: string;
  onHeaderLabelChange?: (value: string) => void;
  headerNodeTypeLabel?: string;
  HeaderIcon?: React.ComponentType<{ className?: string }>;
  headerCategoryColor?: string;
  onRunNode?: () => void;
  runButtonLabel?: string;
  runDisabled?: boolean;
  isRunning?: boolean;
  /** Agent tools props — only provided when nodeType is AGENT */
  agentTools?: Omit<AgentToolsPanelProps, 'portalContainer'>;
}

export function ConfigurationPanel({
  definition,
  formValues,
  onFieldChange,
  credentials,
  credentialsLoading,
  credentialsError,
  onRefreshCredentials,
  onAddNewCredential,
  onEditCredential,
  onRefreshOAuthCredential,
  refreshingCredentialId,
  configWarnings,
  configErrors,
  runError,
  fieldErrors,
  nodeType,
  modelStatusMessage,
  portalContainer,
  upstreamVariables: _upstreamVariables = [],
  inputData,
  headerLabel,
  onHeaderLabelChange,
  headerNodeTypeLabel,
  HeaderIcon,
  headerCategoryColor,
  onRunNode,
  runButtonLabel = 'Run Node',
  runDisabled = false,
  isRunning = false,
  agentTools,
}: ConfigurationPanelProps) {
  const isAgent = nodeType === 'core.agent' && !!agentTools;
  const [activeTab, setActiveTab] = useState<'settings' | 'tools'>('settings');

  const visibleFields = useMemo(
    () => (definition?.paramFields || []).filter((field) => !field.hidden),
    [definition?.paramFields],
  );

  const credentialFields = useMemo(
    () => visibleFields.filter((field) => field.type === 'credential'),
    [visibleFields],
  );

  const otherFields = useMemo(
    () => visibleFields.filter((field) => field.type !== 'credential'),
    [visibleFields],
  );
  const hasExpandableParameterFields = useMemo(
    () => otherFields.some((field) => ['textarea', 'json', 'code'].includes(field.type)),
    [otherFields],
  );

  const requiresCredential = credentialFields.length > 0;

  const parametersEmptyMessage = definition
    ? 'This node does not expose any editable parameters.'
    : 'No configuration available for this node.';

  return (
    <ResizablePanel defaultSize={30} minSize={20} className="h-full">
      <div className="flex flex-col h-full overflow-hidden fl-node-config-root bg-background">
        {/* Node identity header */}
        {headerLabel !== undefined && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            {HeaderIcon && (
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                  headerCategoryColor,
                )}
              >
                <HeaderIcon className="w-3.5 h-3.5" />
              </div>
            )}
            <InlineEdit
              value={headerLabel}
              onChange={
                onHeaderLabelChange ??
                (() => {
                  // noop
                })
              }
              placeholder="Untitled Node"
              displayClassName="text-sm font-semibold truncate"
              inputClassName="text-sm font-semibold h-auto py-0.5 px-1"
            />
            {headerNodeTypeLabel && !isAgent && (
              <span className="text-[10px] text-muted-foreground capitalize shrink-0">
                {headerNodeTypeLabel}
              </span>
            )}
            <div className="flex-1" />

            {/* Agent tab bar — centered, matches ModeSwitcher (edit/runs) style */}
            {isAgent && (
              <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab('settings')}
                  className={cn(
                    'h-7 gap-1.5 rounded-sm px-2.5 text-xs font-medium',
                    activeTab === 'settings'
                      ? 'bg-card text-foreground shadow-sm hover:bg-card border border-border/60'
                      : 'text-muted-foreground/60 hover:text-foreground border border-transparent',
                  )}
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab('tools')}
                  className={cn(
                    'h-7 gap-1.5 rounded-sm px-2.5 text-xs font-medium',
                    activeTab === 'tools'
                      ? 'bg-card text-foreground shadow-sm hover:bg-card border border-border/60'
                      : 'text-muted-foreground/60 hover:text-foreground border border-transparent',
                  )}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Tools
                  {agentTools && agentTools.addedTools.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
                      {agentTools.addedTools.length}
                    </Badge>
                  )}
                </Button>
              </div>
            )}

            <div className="flex-1" />

            <Button
              variant="default"
              size="sm"
              className="h-8 px-3 gap-1.5 shrink-0 text-xs font-semibold"
              onClick={() => {
                if (!runDisabled && !isRunning && onRunNode) {
                  onRunNode();
                }
              }}
              disabled={runDisabled || isRunning}
            >
              {isRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {isRunning ? 'Running…' : runButtonLabel}
            </Button>
          </div>
        )}

        {/* ── Tab Content ─────────────────────────────────────── */}
        {isAgent && activeTab === 'tools' ? (
          <AgentToolsPanel {...agentTools} portalContainer={portalContainer} />
        ) : (
          /* Settings content (default, or always for non-agent nodes) */
          <ScrollArea className="flex-1 min-h-0">
            <div
              className={cn(
                'fl-node-config-form min-h-full p-3 text-xs flex flex-col gap-4',
                hasExpandableParameterFields && 'h-full',
              )}
            >
              {/* Credentials section */}
              {requiresCredential && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-muted-foreground" />
                    <h4 className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
                      Credentials
                    </h4>
                  </div>
                  <CredentialsSection
                    fields={credentialFields}
                    formValues={formValues}
                    onFieldChange={onFieldChange}
                    credentials={credentials}
                    isLoading={credentialsLoading}
                    isError={credentialsError}
                    onRefresh={onRefreshCredentials}
                    onAddNewCredential={onAddNewCredential}
                    onEditCredential={onEditCredential}
                    onRefreshOAuthCredential={onRefreshOAuthCredential}
                    refreshingCredentialId={refreshingCredentialId}
                    portalContainer={portalContainer}
                    disablePortal
                  />
                </div>
              )}

              {/* Parameters section */}
              <div
                className={cn(
                  'flex flex-col gap-2.5',
                  hasExpandableParameterFields && 'flex-1 min-h-0',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Settings className="w-3 h-3 text-muted-foreground" />
                  <h4 className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
                    Parameters
                  </h4>
                </div>
                <ParametersSection
                  fields={definition ? otherFields : []}
                  formValues={formValues}
                  onFieldChange={onFieldChange}
                  emptyMessage={parametersEmptyMessage}
                  portalContainer={portalContainer}
                  nodeType={nodeType}
                  inputData={inputData}
                  fieldErrors={fieldErrors}
                />
              </div>

              {/* Warnings */}
              {configWarnings.length > 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30 border border-border">
                  <AlertTriangle className="w-3.5 h-3.5 text-accent-foreground mt-0.5 shrink-0" />
                  <div className="space-y-1 text-xs text-accent-foreground">
                    {configWarnings.map((warning, index) => (
                      <div key={`node-config-warning-${index}`}>{warning}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors */}
              {configErrors.length > 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/5 border border-destructive/20">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  <div className="space-y-1 text-xs text-destructive">
                    {configErrors.map((error, index) => (
                      <div key={`node-config-error-${index}`}>{error}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Run error */}
              {runError ? <ExecutionErrorDisplay error={runError} /> : null}

              {/* Model status message */}
              {nodeType === 'core.model' && modelStatusMessage && (
                <div className="px-1 text-xs text-muted-foreground">{modelStatusMessage}</div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </ResizablePanel>
  );
}
