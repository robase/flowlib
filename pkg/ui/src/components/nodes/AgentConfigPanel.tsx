'use client';

import { memo, useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';
import {
  Settings,
  Wrench,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  X,
  Trash2,
  Bot,
} from 'lucide-react';
import { ProviderIcon } from '../shared/ProviderIcon';
import { ToolParamField, type AddCredentialRequest } from './ToolParamField';
import { CreateCredentialModal } from '../credentials/CreateCredentialModal';
import { OAuth2ProviderSelector } from '../credentials/OAuth2ProviderSelector';
import { useCredentials, useCreateCredential } from '../../api/credentials.api';
import { useNodeRegistry } from '../../contexts/NodeRegistryContext';
import type { ToolDefinition, AddedToolInstance } from './ToolSelectorModal';
import type { NodeParamField } from '../../types/node-definition.types';
import type { CreateCredentialInput, Credential } from '../../api/types';

// ─── Types ─────────────────────────────────────────────────────────

interface AgentSettings {
  credentialId: string;
  model: string;
  taskPrompt: string;
  systemPrompt: string;
  maxIterations: number;
  stopCondition: 'explicit_stop' | 'tool_result' | 'max_iterations';
  temperature: number;
  maxTokens: number | undefined;
  enableParallelTools: boolean;
  toolTimeoutMs: number;
  maxConversationTokens: number;
  useBatchProcessing: boolean;
}

type SidebarView = 'settings' | 'add-tool' | `tool-${string}`;

export interface AgentConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the agent node */
  agentName: string;
  /** Available tools fetched from the API */
  availableTools: ToolDefinition[];
  /** Currently added tool instances on this agent */
  addedTools: AddedToolInstance[];
  /** Current agent node params */
  agentParams: Record<string, unknown>;
  /** Called to add a tool instance, returns the new instanceId */
  onAddTool: (toolId: string) => string;
  /** Called to remove a tool instance */
  onRemoveTool: (instanceId: string) => void;
  /** Called to update a tool instance */
  onUpdateTool: (
    instanceId: string,
    updates: Partial<Omit<AddedToolInstance, 'instanceId' | 'toolId'>>,
  ) => void;
  /** Called to update agent-level params */
  onUpdateParams: (params: Record<string, unknown>) => void;
  /** Portal container for sub-modals */
  portalContainer?: HTMLElement | null;
}

// ─── Main Dialog ───────────────────────────────────────────────────

export const AgentConfigDialog = memo(function AgentConfigDialog({
  open,
  onOpenChange,
  agentName,
  availableTools,
  addedTools,
  agentParams,
  onAddTool,
  onRemoveTool,
  onUpdateTool,
  onUpdateParams,
  portalContainer,
}: AgentConfigDialogProps) {
  const [activeView, setActiveView] = useState<SidebarView>('settings');
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Credential modal state
  const queryClient = useQueryClient();
  const [isCreateCredentialOpen, setIsCreateCredentialOpen] = useState(false);
  const [isOAuth2SelectorOpen, setIsOAuth2SelectorOpen] = useState(false);
  const [activeCredentialField, setActiveCredentialField] = useState<string | null>(null);
  const [activeOAuth2Providers, setActiveOAuth2Providers] = useState<string[] | null>(null);
  const createCredentialMutation = useCreateCredential();
  const { data: credentialsData } = useCredentials();
  const credentials = credentialsData ?? [];

  // Build settings from agentParams
  const settings: AgentSettings = useMemo(
    () => ({
      credentialId: (agentParams.credentialId as string) ?? '',
      model: (agentParams.model as string) ?? '',
      taskPrompt: (agentParams.taskPrompt as string) ?? '',
      systemPrompt: (agentParams.systemPrompt as string) ?? '',
      maxIterations: (agentParams.maxIterations as number) ?? 10,
      stopCondition:
        (agentParams.stopCondition as AgentSettings['stopCondition']) ?? 'explicit_stop',
      temperature: (agentParams.temperature as number) ?? 0.7,
      maxTokens: agentParams.maxTokens as number | undefined,
      enableParallelTools: (agentParams.enableParallelTools as boolean) ?? true,
      toolTimeoutMs: (agentParams.toolTimeoutMs as number) ?? 30000,
      maxConversationTokens: (agentParams.maxConversationTokens as number) ?? 500000,
      useBatchProcessing: (agentParams.useBatchProcessing as boolean) ?? false,
    }),
    [agentParams],
  );

  const updateSettings = useCallback(
    (partial: Partial<AgentSettings>) => {
      onUpdateParams({ ...agentParams, ...partial });
    },
    [agentParams, onUpdateParams],
  );

  // Filter tools for discovery
  const filteredTools = useMemo(() => {
    return availableTools.filter((tool) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q) ||
        (tool.provider?.name ?? '').toLowerCase().includes(q);
      const matchesCategory = categoryFilter === 'all' || tool.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [availableTools, searchQuery, categoryFilter]);

  // Group by provider
  const toolsByProvider = useMemo(() => {
    const grouped: Record<string, ToolDefinition[]> = {};
    for (const tool of filteredTools) {
      const providerName = tool.provider?.name ?? 'Other';
      if (!grouped[providerName]) {
        grouped[providerName] = [];
      }
      grouped[providerName].push(tool);
    }
    return grouped;
  }, [filteredTools]);

  const handleAddTool = useCallback(
    (tool: ToolDefinition) => {
      const instanceId = onAddTool(tool.id);
      if (instanceId) {
        setActiveView(`tool-${instanceId}`);
      }
    },
    [onAddTool],
  );

  const handleRemoveTool = useCallback(
    (instanceId: string) => {
      onRemoveTool(instanceId);
      setActiveView('settings');
    },
    [onRemoveTool],
  );

  const getToolForInstance = useCallback(
    (instance: AddedToolInstance) => {
      return availableTools.find((t) => t.id === instance.toolId);
    },
    [availableTools],
  );

  const selectedInstance = useMemo(() => {
    if (!activeView.startsWith('tool-')) {
      return null;
    }
    const instanceId = activeView.replace('tool-', '');
    return addedTools.find((t) => t.instanceId === instanceId) ?? null;
  }, [activeView, addedTools]);

  // Reset view if selected instance was removed
  useEffect(() => {
    if (activeView.startsWith('tool-') && !selectedInstance) {
      setActiveView('settings');
    }
  }, [activeView, selectedInstance]);

  // Credential handlers
  const handleAddCredential = useCallback((request: AddCredentialRequest) => {
    setActiveCredentialField(request.fieldName);
    if (request.oauth2Providers && request.oauth2Providers.length > 0) {
      setActiveOAuth2Providers(request.oauth2Providers);
      setIsOAuth2SelectorOpen(true);
    } else {
      setIsCreateCredentialOpen(true);
    }
  }, []);

  const handleCredentialCreated = useCallback(
    async (createdCredential: Credential) => {
      await queryClient.refetchQueries({ queryKey: ['credentials'] });

      // If this credential was created for the agent-level credential field
      if (activeCredentialField === '__agent_credential__') {
        updateSettings({ credentialId: createdCredential.id });
      } else if (activeCredentialField && selectedInstance) {
        // For tool instance credential fields
        onUpdateTool(selectedInstance.instanceId, {
          params: { ...selectedInstance.params, [activeCredentialField]: createdCredential.id },
        });
      }

      setIsCreateCredentialOpen(false);
      setIsOAuth2SelectorOpen(false);
      setActiveCredentialField(null);
      setActiveOAuth2Providers(null);
    },
    [queryClient, activeCredentialField, selectedInstance, onUpdateTool, updateSettings],
  );

  const handleCreateCredential = useCallback(
    (input: CreateCredentialInput) => {
      createCredentialMutation.mutate(input, {
        onSuccess: (created) => handleCredentialCreated(created),
      });
    },
    [createCredentialMutation, handleCredentialCreated],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-none sm:max-w-none h-[85vh] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div className="flex h-full">
          {/* ── Sidebar ─────────────────────────────────────────── */}
          <div className="flex flex-col w-64 border-r border-border bg-muted/30">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Bot className="size-5 text-primary" />
                <span className="text-sm font-semibold truncate">{agentName}</span>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2">
                {/* Agent Settings */}
                <button
                  onClick={() => setActiveView('settings')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    activeView === 'settings'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Settings className="size-4" />
                  Agent Settings
                </button>

                {/* Tools Section */}
                <Collapsible open={toolsExpanded} onOpenChange={setToolsExpanded} className="mt-2">
                  <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                    <div className="flex items-center gap-3">
                      <Wrench className="size-4" />
                      <span>Tools</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                        {addedTools.length}
                      </Badge>
                      {toolsExpanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="mt-1 space-y-1">
                    {/* Add Tool Button */}
                    <button
                      onClick={() => setActiveView('add-tool')}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ml-2',
                        activeView === 'add-tool'
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <Plus className="size-4" />
                      Add Tool
                    </button>

                    {/* Tool Instances */}
                    {addedTools.map((instance) => {
                      const tool = getToolForInstance(instance);
                      return (
                        <button
                          key={instance.instanceId}
                          onClick={() => setActiveView(`tool-${instance.instanceId}`)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ml-2 group',
                            activeView === `tool-${instance.instanceId}`
                              ? 'bg-accent text-accent-foreground font-medium'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                          )}
                        >
                          <span className="text-muted-foreground shrink-0">
                            {tool?.provider?.id ? (
                              <ProviderIcon
                                providerId={tool.provider.id}
                                svgIcon={tool.provider.svgIcon}
                                icon={tool.provider.icon}
                                className="size-4"
                              />
                            ) : (
                              <Wrench className="size-4" />
                            )}
                          </span>
                          <span className="flex-1 text-left truncate">{instance.name}</span>
                        </button>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="flex gap-2 p-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>

          {/* ── Main Content ────────────────────────────────────── */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <DialogHeader className="p-0">
                <DialogTitle className="text-base font-semibold">
                  {activeView === 'settings' && 'Agent Settings'}
                  {activeView === 'add-tool' && 'Add Tool'}
                  {selectedInstance && (
                    <div className="flex items-center gap-2">
                      {(() => {
                        const tool = getToolForInstance(selectedInstance);
                        return tool?.provider?.id ? (
                          <ProviderIcon
                            providerId={tool.provider.id}
                            svgIcon={tool.provider.svgIcon}
                            icon={tool.provider.icon}
                            className="size-4 text-muted-foreground"
                          />
                        ) : (
                          <Wrench className="size-4 text-muted-foreground" />
                        );
                      })()}
                      {selectedInstance.name}
                    </div>
                  )}
                </DialogTitle>
              </DialogHeader>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="p-6">
                {activeView === 'settings' && (
                  <AgentSettingsView
                    settings={settings}
                    credentials={credentials}
                    onSettingsChange={updateSettings}
                    onAddCredential={() => {
                      setActiveCredentialField('__agent_credential__');
                      setIsCreateCredentialOpen(true);
                    }}
                  />
                )}
                {activeView === 'add-tool' && (
                  <ToolDiscoveryView
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    categoryFilter={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    toolsByProvider={toolsByProvider}
                    addedTools={addedTools}
                    onAddTool={handleAddTool}
                  />
                )}
                {selectedInstance && (
                  <ToolInstanceView
                    instance={selectedInstance}
                    tool={getToolForInstance(selectedInstance) ?? null}
                    onUpdate={onUpdateTool}
                    onRemove={() => handleRemoveTool(selectedInstance.instanceId)}
                    onAddCredential={handleAddCredential}
                  />
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>

      {/* Credential modals */}
      <CreateCredentialModal
        open={isCreateCredentialOpen}
        onClose={() => {
          setIsCreateCredentialOpen(false);
          setActiveCredentialField(null);
        }}
        onSubmit={handleCreateCredential}
        isLoading={createCredentialMutation.isPending}
        portalContainer={portalContainer}
      />

      <OAuth2ProviderSelector
        open={isOAuth2SelectorOpen}
        onOpenChange={(o) => {
          if (!o) {
            setIsOAuth2SelectorOpen(false);
            setActiveCredentialField(null);
            setActiveOAuth2Providers(null);
          }
        }}
        onCredentialCreated={handleCredentialCreated}
        portalContainer={portalContainer}
        filterProviders={activeOAuth2Providers ?? undefined}
      />
    </Dialog>
  );
});

AgentConfigDialog.displayName = 'AgentConfigDialog';

// ─── Agent Settings View ───────────────────────────────────────────

function AgentSettingsView({
  settings,
  credentials,
  onSettingsChange,
  onAddCredential,
}: {
  settings: AgentSettings;
  credentials: Array<{ id: string; name: string; type?: string }>;
  onSettingsChange: (partial: Partial<AgentSettings>) => void;
  onAddCredential: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Credentials & Model */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Credentials & Model</h3>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="credential">Credential</Label>
            <div className="flex gap-2">
              <Select
                value={settings.credentialId}
                onValueChange={(v) => onSettingsChange({ credentialId: v })}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select credential" />
                </SelectTrigger>
                <SelectContent>
                  {credentials.map((cred) => (
                    <SelectItem key={cred.id} value={cred.id}>
                      {cred.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={onAddCredential}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={settings.model}
              onChange={(e) => onSettingsChange({ model: e.target.value })}
              placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
            />
            <p className="text-xs text-muted-foreground">
              Model identifier matching your credential provider.
            </p>
          </div>
        </div>
      </section>

      <Separator />

      {/* Prompts */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Prompts</h3>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-prompt">Task Prompt</Label>
            <Textarea
              id="task-prompt"
              placeholder="Enter the main instruction for the agent. Supports {{ upstream_node.field }} template syntax..."
              className="font-mono text-sm min-h-32"
              value={settings.taskPrompt}
              onChange={(e) => onSettingsChange({ taskPrompt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              The primary instruction telling the agent what to do.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="system-prompt">System Prompt (Optional)</Label>
            <Textarea
              id="system-prompt"
              placeholder="Enter system-level instructions..."
              className="font-mono text-sm min-h-24"
              value={settings.systemPrompt}
              onChange={(e) => onSettingsChange({ systemPrompt: e.target.value })}
            />
          </div>
        </div>
      </section>

      <Separator />

      {/* Advanced Settings */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80">
          {advancedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Advanced Settings
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Iterations</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[settings.maxIterations]}
                  onValueChange={([v]) => onSettingsChange({ maxIterations: v })}
                  max={200}
                  min={1}
                  step={1}
                  className="flex-1"
                />
                <span className="w-8 text-sm text-right text-muted-foreground">
                  {settings.maxIterations}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Temperature</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[settings.temperature]}
                  onValueChange={([v]) => onSettingsChange({ temperature: v })}
                  max={2}
                  min={0}
                  step={0.1}
                  className="flex-1"
                />
                <span className="w-8 text-sm text-right text-muted-foreground">
                  {settings.temperature.toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Stop Condition</Label>
            <Select
              value={settings.stopCondition}
              onValueChange={(v: AgentSettings['stopCondition']) =>
                onSettingsChange({ stopCondition: v })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="explicit_stop">Explicit Stop</SelectItem>
                <SelectItem value="tool_result">First Tool Result</SelectItem>
                <SelectItem value="max_iterations">Max Iterations</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Tokens</Label>
              <Input
                type="number"
                value={settings.maxTokens ?? ''}
                onChange={(e) =>
                  onSettingsChange({
                    maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder="Default"
              />
            </div>

            <div className="space-y-2">
              <Label>Tool Timeout (ms)</Label>
              <Input
                type="number"
                value={settings.toolTimeoutMs}
                onChange={(e) =>
                  onSettingsChange({ toolTimeoutMs: parseInt(e.target.value) || 30000 })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Conversation Tokens</Label>
              <Input
                type="number"
                value={settings.maxConversationTokens}
                onChange={(e) =>
                  onSettingsChange({
                    maxConversationTokens: parseInt(e.target.value) || 500000,
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Enable Parallel Tools</Label>
                <p className="text-xs text-muted-foreground">
                  Allow multiple tools to run simultaneously
                </p>
              </div>
              <Switch
                checked={settings.enableParallelTools}
                onChange={(e) => onSettingsChange({ enableParallelTools: e.target.checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Use Batch Processing</Label>
                <p className="text-xs text-muted-foreground">
                  Process requests in batches for efficiency
                </p>
              </div>
              <Switch
                checked={settings.useBatchProcessing}
                onChange={(e) => onSettingsChange({ useBatchProcessing: e.target.checked })}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─── Tool Discovery View ───────────────────────────────────────────

function ToolDiscoveryView({
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  toolsByProvider,
  addedTools,
  onAddTool,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categoryFilter: string;
  onCategoryChange: (category: string) => void;
  toolsByProvider: Record<string, ToolDefinition[]>;
  addedTools: AddedToolInstance[];
  onAddTool: (tool: ToolDefinition) => void;
}) {
  const categories = [
    { id: 'all', label: 'All' },
    { id: 'data', label: 'Data' },
    { id: 'web', label: 'Web' },
    { id: 'code', label: 'Code' },
    { id: 'utility', label: 'Utility' },
    { id: 'custom', label: 'Custom' },
  ];

  const getInstanceCount = (toolId: string) => {
    return addedTools.filter((t) => t.toolId === toolId).length;
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute -translate-y-1/2 left-3 top-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search tools..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Categories */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <Button
            key={cat.id}
            variant={categoryFilter === cat.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => onCategoryChange(cat.id)}
          >
            {cat.label}
          </Button>
        ))}
      </div>

      {/* Tool Grid by Provider */}
      <div className="space-y-6">
        {Object.entries(toolsByProvider).map(([provider, tools]) => (
          <div key={provider}>
            <h4 className="flex items-center gap-2 mb-3 text-sm font-semibold text-muted-foreground">
              {tools[0]?.provider?.id && (
                <ProviderIcon
                  providerId={tools[0].provider.id}
                  svgIcon={tools[0].provider.svgIcon}
                  icon={tools[0].provider.icon}
                  className="size-4"
                />
              )}
              {provider}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => {
                const count = getInstanceCount(tool.id);
                return (
                  <div
                    key={tool.id}
                    className="relative p-4 transition-colors border rounded-lg group border-border hover:border-primary/50 hover:bg-accent/50"
                  >
                    {count > 0 && (
                      <Badge
                        variant="secondary"
                        className="absolute top-2 right-2 h-5 px-1.5 text-xs"
                      >
                        ×{count}
                      </Badge>
                    )}
                    <div className="flex items-start gap-3">
                      <span className="text-muted-foreground mt-0.5">
                        {tool.provider?.id ? (
                          <ProviderIcon
                            providerId={tool.provider.id}
                            svgIcon={tool.provider.svgIcon}
                            icon={tool.provider.icon}
                            className="size-4"
                          />
                        ) : (
                          <Wrench className="size-4" />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h5 className="text-sm font-medium">{tool.name}</h5>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {tool.description}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute transition-opacity opacity-0 bottom-2 right-2 group-hover:opacity-100"
                      onClick={() => onAddTool(tool)}
                    >
                      <Plus className="mr-1 size-4" />
                      Add
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(toolsByProvider).length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">No tools match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tool Instance View ────────────────────────────────────────────

function ToolInstanceView({
  instance,
  tool,
  onUpdate,
  onRemove,
  onAddCredential,
}: {
  instance: AddedToolInstance;
  tool: ToolDefinition | null;
  onUpdate: (
    instanceId: string,
    updates: Partial<Omit<AddedToolInstance, 'instanceId' | 'toolId'>>,
  ) => void;
  onRemove: () => void;
  onAddCredential: (request: AddCredentialRequest) => void;
}) {
  const [showSchema, setShowSchema] = useState(false);
  const { getNodeDefinition } = useNodeRegistry();

  // Get param fields from the underlying node definition
  const nodeDefinition = tool?.nodeType ? getNodeDefinition(tool.nodeType) : undefined;
  const paramFields = useMemo(() => {
    const allFields = nodeDefinition?.paramFields ?? [];
    const visibleFields = allFields.filter((field: NodeParamField) => !field.hidden);
    return visibleFields.sort((a: NodeParamField, b: NodeParamField) => {
      if (a.type === 'credential' && b.type !== 'credential') {
        return -1;
      }
      if (a.type !== 'credential' && b.type === 'credential') {
        return 1;
      }
      return 0;
    });
  }, [nodeDefinition]);

  // Compute effective input schema
  const effectiveInputSchema = useMemo(() => {
    if (!tool?.inputSchema || !instance) {
      return tool?.inputSchema;
    }

    const aiChosenModes = (instance.params._aiChosenModes as Record<string, boolean>) ?? {};
    const schema = tool.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    if (!schema.properties) {
      return schema;
    }

    const filteredProperties: Record<string, unknown> = {};
    const staticParams: string[] = [];

    for (const [key, value] of Object.entries(schema.properties)) {
      if (aiChosenModes[key] ?? true) {
        filteredProperties[key] = value;
      } else {
        staticParams.push(key);
      }
    }

    return {
      ...schema,
      properties: filteredProperties,
      required: schema.required?.filter((key) => aiChosenModes[key] ?? true),
      _staticParams: staticParams.length > 0 ? staticParams : undefined,
    };
  }, [tool?.inputSchema, instance]);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header Info */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Tool: <code className="bg-muted px-1 py-0.5 rounded">{instance.toolId}</code>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onRemove}
        >
          <Trash2 className="mr-2 size-4" />
          Remove Tool
        </Button>
      </div>

      {/* Instance Identity */}
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="instance-name">Instance Name</Label>
          <Input
            id="instance-name"
            value={instance.name}
            onChange={(e) => onUpdate(instance.instanceId, { name: e.target.value })}
            placeholder="Give this tool instance a name..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="instance-desc">Instance Description</Label>
          <Textarea
            id="instance-desc"
            value={instance.description}
            onChange={(e) => onUpdate(instance.instanceId, { description: e.target.value })}
            placeholder="Describe when/how this tool should be used..."
            className="min-h-20"
          />
        </div>
      </section>

      <Separator />

      {/* Parameters via real ToolParamField */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Parameters</h3>

        {paramFields.length > 0 ? (
          <div className="space-y-3">
            {paramFields.map((field: NodeParamField) => {
              const aiChosenModes =
                (instance.params._aiChosenModes as Record<string, boolean>) ?? {};
              const isAiChosen = aiChosenModes[field.name] ?? true;
              return (
                <ToolParamField
                  key={field.name}
                  field={field}
                  value={instance.params[field.name]}
                  onChange={(value) => {
                    onUpdate(instance.instanceId, {
                      params: { ...instance.params, [field.name]: value },
                    });
                  }}
                  aiChosen={isAiChosen}
                  onAiChosenChange={(enabled) => {
                    const updatedModes = { ...aiChosenModes, [field.name]: enabled };
                    onUpdate(instance.instanceId, {
                      params: { ...instance.params, _aiChosenModes: updatedModes },
                    });
                  }}
                  onAddCredential={onAddCredential}
                  actionId={tool?.nodeType}
                  formValues={instance.params as Record<string, unknown>}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            This tool has no configurable parameters.
          </p>
        )}
      </section>

      <Separator />

      {/* Effective Schema */}
      <Collapsible open={showSchema} onOpenChange={setShowSchema}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80">
          {showSchema ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Effective Schema
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="p-4 overflow-auto rounded-lg bg-muted/50">
            {effectiveInputSchema &&
              '_staticParams' in effectiveInputSchema &&
              (effectiveInputSchema as { _staticParams?: string[] })._staticParams && (
                <div className="pb-2 mb-2 text-[10px] border-b text-muted-foreground">
                  <span className="font-medium">Static params (not sent to AI): </span>
                  {(
                    (effectiveInputSchema as { _staticParams?: string[] })._staticParams ?? []
                  ).join(', ')}
                </div>
              )}
            <pre className="text-[10px] whitespace-pre-wrap font-mono text-muted-foreground">
              {JSON.stringify(effectiveInputSchema, null, 2)}
            </pre>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            This is the schema the agent will see. Parameters with AI-chosen: OFF are hidden.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
