'use client';

import { memo, useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollArea } from '../../../ui/scroll-area';
import { Button } from '../../../ui/button';
import { Badge } from '../../../ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../ui/collapsible';
import { Separator } from '../../../ui/separator';
import { cn } from '../../../../lib/utils';
import {
  Plus,
  Search,
  ChevronRight,
  X,
  Trash2,
  Wrench,
  ChevronDown,
  ChevronsUpDown,
  Check,
} from 'lucide-react';
import { ProviderIcon } from '../../../shared/ProviderIcon';
import { ToolParamField, type AddCredentialRequest } from '../../../nodes/ToolParamField';
import { CreateCredentialModal } from '../../../credentials/CreateCredentialModal';
import { OAuth2ProviderSelector } from '../../../credentials/OAuth2ProviderSelector';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../ui/command';
import { useCreateCredential } from '../../../../api/credentials.api';
import { useNodeRegistry } from '../../../../contexts/NodeRegistryContext';
import type { ToolDefinition, AddedToolInstance } from '../../../nodes/ToolSelectorModal';
import type { NodeParamField } from '../../../../types/node-definition.types';
import type { CreateCredentialInput, Credential } from '../../../../api/types';

// ─── Types ─────────────────────────────────────────────────────────

type ToolSubView = 'discovery' | `instance-${string}`;

export interface AgentToolsPanelProps {
  /** Available tools fetched from the API */
  availableTools: ToolDefinition[];
  /** Currently added tool instances on this agent */
  addedTools: AddedToolInstance[];
  /** Called to add a tool instance */
  onAddTool: (toolId: string) => string;
  /** Called to remove a tool instance */
  onRemoveTool: (instanceId: string) => void;
  /** Called to update a tool instance */
  onUpdateTool: (
    instanceId: string,
    updates: Partial<Omit<AddedToolInstance, 'instanceId' | 'toolId'>>,
  ) => void;
  /** Portal container for sub-modals */
  portalContainer?: HTMLElement | null;
  /** Pre-select a specific tool instance (e.g. opened from AgentToolsBox click) */
  initialToolInstanceId?: string | null;
}

// ─── Main Panel ────────────────────────────────────────────────────

export const AgentToolsPanel = memo(function AgentToolsPanel({
  availableTools,
  addedTools,
  onAddTool,
  onRemoveTool,
  onUpdateTool,
  portalContainer,
  initialToolInstanceId,
}: AgentToolsPanelProps) {
  const [activeView, setActiveView] = useState<ToolSubView>(
    initialToolInstanceId ? `instance-${initialToolInstanceId}` : 'discovery',
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Credential modal state
  const queryClient = useQueryClient();
  const [isCreateCredentialOpen, setIsCreateCredentialOpen] = useState(false);
  const [isOAuth2SelectorOpen, setIsOAuth2SelectorOpen] = useState(false);
  const [activeCredentialField, setActiveCredentialField] = useState<string | null>(null);
  const [activeOAuth2Providers, setActiveOAuth2Providers] = useState<string[] | null>(null);
  const createCredentialMutation = useCreateCredential();

  // Filter tools for discovery
  const filteredTools = useMemo(() => {
    return availableTools.filter((tool) => {
      const q = searchQuery.toLowerCase();
      return (
        !q ||
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q) ||
        (tool.provider?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [availableTools, searchQuery]);

  // Group by provider
  const toolsByProvider = useMemo(() => {
    const grouped: Record<
      string,
      { tools: ToolDefinition[]; provider: ToolDefinition['provider'] }
    > = {};
    for (const tool of filteredTools) {
      const providerKey = tool.provider?.id ?? 'other';
      if (!grouped[providerKey]) {
        grouped[providerKey] = { tools: [], provider: tool.provider };
      }
      grouped[providerKey].tools.push(tool);
    }
    return grouped;
  }, [filteredTools]);

  const handleAddTool = useCallback(
    (tool: ToolDefinition) => {
      const instanceId = onAddTool(tool.id);
      if (instanceId) {
        setActiveView(`instance-${instanceId}`);
      }
    },
    [onAddTool],
  );

  const handleRemoveTool = useCallback(
    (instanceId: string) => {
      onRemoveTool(instanceId);
      setActiveView('discovery');
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
    if (!activeView.startsWith('instance-')) {
      return null;
    }
    const instanceId = activeView.replace('instance-', '');
    return addedTools.find((t) => t.instanceId === instanceId) ?? null;
  }, [activeView, addedTools]);

  // Reset view if selected instance was removed
  useEffect(() => {
    if (activeView.startsWith('instance-') && !selectedInstance) {
      setActiveView('discovery');
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
      if (activeCredentialField && selectedInstance) {
        onUpdateTool(selectedInstance.instanceId, {
          params: { ...selectedInstance.params, [activeCredentialField]: createdCredential.id },
        });
      }
      setIsCreateCredentialOpen(false);
      setIsOAuth2SelectorOpen(false);
      setActiveCredentialField(null);
      setActiveOAuth2Providers(null);
    },
    [queryClient, activeCredentialField, selectedInstance, onUpdateTool],
  );

  const handleCreateCredential = useCallback(
    (input: CreateCredentialInput) => {
      createCredentialMutation.mutate(input, {
        onSuccess: (created) => handleCredentialCreated(created),
      });
    },
    [createCredentialMutation, handleCredentialCreated],
  );

  const getInstanceCount = useCallback(
    (toolId: string) => addedTools.filter((t) => t.toolId === toolId).length,
    [addedTools],
  );

  const MAX_INLINE_TOOLS = 3;
  const useCombobox = addedTools.length > MAX_INLINE_TOOLS;
  const [comboboxOpen, setComboboxOpen] = useState(false);

  // Selected instance label for combobox trigger
  const comboboxLabel = useMemo(() => {
    if (activeView === 'discovery') {
      return null;
    }
    return selectedInstance?.name ?? null;
  }, [activeView, selectedInstance]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Tool Strip (horizontal bar) ─────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <button
          onClick={() => setActiveView('discovery')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium shrink-0 transition-colors',
            activeView === 'discovery'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          <Plus className="w-3 h-3" />
          Add
        </button>

        {useCombobox ? (
          /* ── Combobox dropdown for >3 tools ─────────────── */
          <Popover open={comboboxOpen} onOpenChange={setComboboxOpen} modal>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors min-w-0',
                  'border border-border hover:bg-muted/50',
                  comboboxLabel ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {comboboxLabel ? (
                  <>
                    {selectedInstance &&
                      (() => {
                        const tool = getToolForInstance(selectedInstance);
                        return tool?.provider?.id ? (
                          <ProviderIcon
                            providerId={tool.provider.id}
                            svgIcon={tool.provider.svgIcon}
                            icon={tool.provider.icon}
                            className="w-3.5 h-3.5 shrink-0"
                          />
                        ) : (
                          <Wrench className="w-3.5 h-3.5 shrink-0" />
                        );
                      })()}
                    <span className="truncate max-w-28">{comboboxLabel}</span>
                  </>
                ) : (
                  <span>Select tool…</span>
                )}
                <Badge variant="secondary" className="h-4 px-1 text-[10px] shrink-0 tabular-nums">
                  {addedTools.length}
                </Badge>
                <ChevronsUpDown className="w-3 h-3 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search tools…" className="h-8 text-xs" />
                <CommandList>
                  <CommandEmpty>No tools found.</CommandEmpty>
                  <CommandGroup>
                    {addedTools.map((instance) => {
                      const tool = getToolForInstance(instance);
                      const isActive = activeView === `instance-${instance.instanceId}`;
                      return (
                        <CommandItem
                          key={instance.instanceId}
                          value={instance.name}
                          onSelect={() => {
                            setActiveView(`instance-${instance.instanceId}`);
                            setComboboxOpen(false);
                          }}
                          className="gap-2 text-xs"
                        >
                          <span className="shrink-0">
                            {tool?.provider?.id ? (
                              <ProviderIcon
                                providerId={tool.provider.id}
                                svgIcon={tool.provider.svgIcon}
                                icon={tool.provider.icon}
                                className="w-3.5 h-3.5"
                              />
                            ) : (
                              <Wrench className="w-3.5 h-3.5" />
                            )}
                          </span>
                          <span className="truncate flex-1">{instance.name}</span>
                          {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          /* ── Inline pill chips for ≤3 tools ────────────── */
          addedTools.map((instance) => {
            const tool = getToolForInstance(instance);
            const isActive = activeView === `instance-${instance.instanceId}`;
            return (
              <button
                key={instance.instanceId}
                onClick={() => setActiveView(`instance-${instance.instanceId}`)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs shrink-0 transition-colors group max-w-40',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <span className="shrink-0">
                  {tool?.provider?.id ? (
                    <ProviderIcon
                      providerId={tool.provider.id}
                      svgIcon={tool.provider.svgIcon}
                      icon={tool.provider.icon}
                      className="w-3.5 h-3.5"
                    />
                  ) : (
                    <Wrench className="w-3.5 h-3.5" />
                  )}
                </span>
                <span className="truncate">{instance.name}</span>
              </button>
            );
          })
        )}
      </div>

      {/* ── Detail Area ─────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          {activeView === 'discovery' ? (
            <ToolDiscoveryView
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              toolsByProvider={toolsByProvider}
              getInstanceCount={getInstanceCount}
              onAddTool={handleAddTool}
              addedTools={addedTools}
              getToolForInstance={getToolForInstance}
              onSelectInstance={(instanceId) => setActiveView(`instance-${instanceId}`)}
              onRemoveTool={handleRemoveTool}
            />
          ) : selectedInstance ? (
            <ToolInstanceView
              instance={selectedInstance}
              tool={getToolForInstance(selectedInstance) ?? null}
              onUpdate={onUpdateTool}
              onRemove={() => handleRemoveTool(selectedInstance.instanceId)}
              onAddCredential={handleAddCredential}
            />
          ) : null}
        </div>
      </ScrollArea>

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
    </div>
  );
});

// ─── Tool Discovery View ───────────────────────────────────────────

function ToolDiscoveryView({
  searchQuery,
  onSearchChange,
  toolsByProvider,
  getInstanceCount,
  onAddTool,
  addedTools,
  getToolForInstance,
  onSelectInstance,
  onRemoveTool,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  toolsByProvider: Record<
    string,
    { tools: ToolDefinition[]; provider: ToolDefinition['provider'] }
  >;
  getInstanceCount: (toolId: string) => number;
  onAddTool: (tool: ToolDefinition) => void;
  addedTools: AddedToolInstance[];
  getToolForInstance: (instance: AddedToolInstance) => ToolDefinition | undefined;
  onSelectInstance: (instanceId: string) => void;
  onRemoveTool: (instanceId: string) => void;
}) {
  // Track collapsed groups (all groups start expanded)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const isSearching = searchQuery.length > 0;

  const toggleGroup = useCallback((providerId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }, []);

  const sortedProviderIds = useMemo(() => {
    return Object.keys(toolsByProvider).sort((a, b) => {
      const nameA = toolsByProvider[a].provider?.name ?? a;
      const nameB = toolsByProvider[b].provider?.name ?? b;
      // Core first, then alphabetical
      if (a === 'core') {
        return -1;
      }
      if (b === 'core') {
        return 1;
      }
      return nameA.localeCompare(nameB);
    });
  }, [toolsByProvider]);

  return (
    <div className="space-y-3">
      {/* ── Added Tools Grid ──────────────────────────────── */}
      {addedTools.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
              Added Tools
            </h4>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {addedTools.length}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {addedTools.map((instance) => {
              const tool = getToolForInstance(instance);
              const bgColor =
                tool?.provider?.id === 'core' || tool?.provider?.id === 'triggers'
                  ? 'bg-accent text-primary'
                  : 'bg-muted text-muted-foreground';
              return (
                <div
                  key={instance.instanceId}
                  className="relative flex items-center gap-2 p-2 transition-all border rounded-lg cursor-pointer group border-border hover:border-primary/50 hover:bg-accent/50"
                  onClick={() => onSelectInstance(instance.instanceId)}
                >
                  <div
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      bgColor,
                    )}
                  >
                    <ProviderIcon
                      providerId={tool?.provider?.id}
                      svgIcon={tool?.provider?.svgIcon}
                      icon={tool?.provider?.icon}
                      className="w-4 h-4"
                    />
                  </div>
                  <span className="flex-1 min-w-0 text-xs font-medium truncate">
                    {instance.name}
                  </span>
                  <button
                    className="absolute hidden p-0.5 rounded group-hover:flex top-1 right-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTool(instance.instanceId);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <Separator className="mt-1" />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tools…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 w-full rounded-lg border border-border bg-transparent pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute -translate-y-1/2 right-3 top-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Tools grouped by provider */}
      <div className="space-y-3">
        {sortedProviderIds.map((providerId) => {
          const group = toolsByProvider[providerId];
          // Show if searching (always expand) or not manually collapsed
          const shouldShow = isSearching || !collapsedGroups.has(providerId);

          return (
            <div key={providerId}>
              {/* Provider group header */}
              <button
                type="button"
                onClick={() => toggleGroup(providerId)}
                className="flex items-center gap-1.5 mb-2 w-full text-[11px] font-semibold tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight
                  className={cn(
                    'w-3 h-3 shrink-0 transition-transform duration-200',
                    shouldShow && 'rotate-90',
                  )}
                />
                {group.provider?.id && (
                  <ProviderIcon
                    providerId={group.provider.id}
                    svgIcon={group.provider.svgIcon}
                    icon={group.provider.icon}
                    className="w-4 h-4"
                  />
                )}
                <span className="flex-1 text-left">{group.provider?.name ?? providerId}</span>
                <span className="text-[10px] font-normal tabular-nums">{group.tools.length}</span>
              </button>

              {/* Tool list */}
              {shouldShow && (
                <div className="space-y-1.5">
                  {group.tools.map((tool) => {
                    const count = getInstanceCount(tool.id);
                    const bgColor =
                      tool.provider?.id === 'core' || tool.provider?.id === 'triggers'
                        ? 'bg-accent text-primary'
                        : 'bg-muted text-muted-foreground';

                    return (
                      <div
                        key={tool.id}
                        className="relative flex items-center gap-2.5 p-2.5 transition-all border rounded-lg group border-border cursor-pointer hover:border-muted-foreground/50 hover:bg-muted/50"
                        onClick={() => onAddTool(tool)}
                        title={tool.description}
                      >
                        {/* Icon */}
                        <div
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                            bgColor,
                          )}
                        >
                          <ProviderIcon
                            providerId={tool.provider?.id}
                            svgIcon={tool.provider?.svgIcon}
                            icon={tool.provider?.icon}
                            className="w-5 h-5"
                          />
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{tool.name}</span>
                            {count > 0 && (
                              <Badge variant="secondary" className="h-4 px-1 text-[10px] shrink-0">
                                ×{count}
                              </Badge>
                            )}
                          </div>
                          <p className="overflow-hidden text-xs text-muted-foreground line-clamp-1 text-ellipsis">
                            {tool.description}
                          </p>
                        </div>

                        {/* Add button (hover) */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-6 h-6 p-0 transition-opacity opacity-0 shrink-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddTool(tool);
                          }}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {sortedProviderIds.length === 0 && (
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
    for (const [key, value] of Object.entries(schema.properties)) {
      if (aiChosenModes[key] ?? true) {
        filteredProperties[key] = value;
      }
    }

    return {
      ...schema,
      properties: filteredProperties,
      required: schema.required?.filter((key) => aiChosenModes[key] ?? true),
    };
  }, [tool?.inputSchema, instance]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {tool?.provider?.id && (
              <ProviderIcon
                providerId={tool.provider.id}
                svgIcon={tool.provider.svgIcon}
                icon={tool.provider.icon}
                className="w-4 h-4 text-muted-foreground shrink-0"
              />
            )}
            <span className="text-sm font-semibold truncate">{instance.name}</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            {tool?.id ?? instance.toolId}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
          onClick={onRemove}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          Remove
        </Button>
      </div>

      {/* Instance name & description */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
            Instance Name
          </label>
          <input
            type="text"
            value={instance.name}
            onChange={(e) => onUpdate(instance.instanceId, { name: e.target.value })}
            className="h-7 w-full rounded-md border border-border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
            Instance Description
          </label>
          <textarea
            value={instance.description}
            onChange={(e) => onUpdate(instance.instanceId, { description: e.target.value })}
            rows={2}
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50 resize-none"
          />
        </div>
      </div>

      {/* Parameters */}
      {paramFields.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Wrench className="w-3 h-3 text-muted-foreground" />
            <h4 className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
              Parameters
            </h4>
          </div>

          <div className="space-y-3">
            {paramFields.map((field: NodeParamField) => {
              const isCredentialField = field.type === 'credential';
              const aiChosenModes =
                (instance.params._aiChosenModes as Record<string, boolean>) ?? {};
              // Credential fields default to NOT ai-chosen; others default to ai-chosen
              const aiChosen = isCredentialField ? false : (aiChosenModes[field.name] ?? true);

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
                  aiChosen={aiChosen}
                  onAiChosenChange={(enabled) => {
                    const currentModes =
                      (instance.params._aiChosenModes as Record<string, boolean>) ?? {};
                    onUpdate(instance.instanceId, {
                      params: {
                        ...instance.params,
                        _aiChosenModes: { ...currentModes, [field.name]: enabled },
                      },
                    });
                  }}
                  onAddCredential={onAddCredential}
                  actionId={tool?.nodeType}
                  formValues={instance.params as Record<string, unknown>}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Effective Schema */}
      {tool?.inputSchema && (
        <Collapsible open={showSchema} onOpenChange={setShowSchema}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors">
            {showSchema ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Effective Schema
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <pre className="p-2.5 rounded-md bg-muted/50 border border-border text-[10px] font-mono text-muted-foreground overflow-auto max-h-48">
              {JSON.stringify(effectiveInputSchema, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
