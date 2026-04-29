'use client';

import { memo, useState, useMemo, useEffect } from 'react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Plus,
  Database,
  Globe,
  Code2,
  Wrench,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
  Settings,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ProviderIcon } from '../shared/ProviderIcon';
import { useNodeRegistry } from '../../contexts/NodeRegistryContext';
import { ToolParamField, type AddCredentialRequest } from './ToolParamField';
import type { ToolDefinition, ToolCategory, AddedToolInstance } from './ToolSelectorModal';

// ── Category config ────────────────────────────────────────────────────

export const categoryConfig: Record<
  ToolCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  data: { label: 'Data', icon: Database, color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  web: { label: 'Web', icon: Globe, color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  code: {
    label: 'Code',
    icon: Code2,
    color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
  utility: {
    label: 'Utility',
    icon: Wrench,
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  custom: {
    label: 'Custom',
    icon: Sparkles,
    color: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  },
};

const categoryIcons: Record<ToolCategory, React.ElementType> = {
  data: Database,
  web: Globe,
  code: Code2,
  utility: Wrench,
  custom: Sparkles,
};

export const categoryOrder: ToolCategory[] = ['data', 'web', 'code', 'utility', 'custom'];

// ── BrowseToolCard ─────────────────────────────────────────────────────

export const BrowseToolCard = memo(function BrowseToolCard({
  tool,
  onAdd,
  onPreview,
  isActive,
}: {
  tool: ToolDefinition;
  onAdd: () => void;
  onPreview: () => void;
  isActive: boolean;
}) {
  const config = categoryConfig[tool.category];
  const FallbackIcon = config.icon;

  return (
    <div
      className={cn(
        'group relative flex flex-col p-3 rounded-lg border cursor-pointer transition-all h-[100px] select-none',
        isActive
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-border hover:border-muted-foreground/50 hover:bg-muted/50',
      )}
      onClick={onPreview}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
            config.color,
          )}
        >
          {tool.provider?.svgIcon || tool.provider?.icon || tool.provider?.id ? (
            <ProviderIcon
              providerId={tool.provider?.id}
              svgIcon={tool.provider?.svgIcon}
              icon={tool.provider?.icon}
              className="w-3.5 h-3.5"
            />
          ) : (
            <FallbackIcon className="w-3.5 h-3.5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{tool.name}</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-6 h-6 p-0 transition-opacity border opacity-0 shrink-0 group-hover:opacity-100 border-muted-foreground/50 hover:border-primary hover:bg-primary/10 hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex-1 min-w-0">
        <p className="overflow-hidden text-xs text-muted-foreground line-clamp-2 text-ellipsis">
          {tool.description}
        </p>
      </div>
    </div>
  );
});

// ── AddedToolTile ──────────────────────────────────────────────────────

export const AddedToolTile = memo(function AddedToolTile({
  instance,
  toolDef,
  isActive,
  onSelect,
  onRemove,
}: {
  instance: AddedToolInstance;
  toolDef: ToolDefinition | undefined;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const category = toolDef?.category ?? 'utility';
  const config = categoryConfig[category];
  const FallbackIcon = categoryIcons[category];

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all',
        isActive
          ? 'border-primary bg-primary/10 ring-1 ring-primary/20'
          : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30',
      )}
      onClick={onSelect}
    >
      <div
        className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded', config.color)}
      >
        {toolDef?.provider?.svgIcon || toolDef?.provider?.icon || toolDef?.provider?.id ? (
          <ProviderIcon
            providerId={toolDef?.provider?.id}
            svgIcon={toolDef?.provider?.svgIcon}
            icon={toolDef?.provider?.icon}
            className="w-3.5 h-3.5"
          />
        ) : (
          <FallbackIcon className="w-3.5 h-3.5" />
        )}
      </div>
      <span className="flex-1 text-xs font-medium truncate">{instance.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="flex items-center justify-center w-5 h-5 transition-opacity rounded-full opacity-0 shrink-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
        title="Remove tool"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
});

// ── ToolDetailsPanel ───────────────────────────────────────────────────

export const ToolDetailsPanel = memo(function ToolDetailsPanel({
  tool,
  instance,
  onAdd,
  onUpdate,
  onRemove,
  onAddCredential,
  portalContainer: _portalContainer,
}: {
  tool: ToolDefinition | null;
  instance: AddedToolInstance | null;
  onAdd?: () => void;
  onUpdate?: (updates: Partial<Omit<AddedToolInstance, 'instanceId' | 'toolId'>>) => void;
  onRemove?: () => void;
  onAddCredential?: (request: AddCredentialRequest) => void;
  portalContainer?: HTMLElement | null;
}) {
  const [showSchema, setShowSchema] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const { getNodeDefinition } = useNodeRegistry();
  const nodeDefinition = tool?.nodeType ? getNodeDefinition(tool.nodeType) : undefined;

  const paramFields = useMemo(() => {
    const allFields = nodeDefinition?.paramFields ?? [];
    const visibleFields = allFields.filter((field) => !field.hidden);
    return visibleFields.sort((a, b) => {
      if (a.type === 'credential' && b.type !== 'credential') {
        return -1;
      }
      if (a.type !== 'credential' && b.type === 'credential') {
        return 1;
      }
      return 0;
    });
  }, [nodeDefinition]);

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
      const isAiChosen = aiChosenModes[key] ?? true;
      if (isAiChosen) {
        filteredProperties[key] = value;
      } else {
        staticParams.push(key);
      }
    }

    const filteredRequired = schema.required?.filter((key) => {
      const isAiChosen = aiChosenModes[key] ?? true;
      return isAiChosen;
    });

    return {
      ...schema,
      properties: filteredProperties,
      required: filteredRequired,
      _staticParams: staticParams.length > 0 ? staticParams : undefined,
    };
  }, [tool?.inputSchema, instance]);

  useEffect(() => {
    if (instance) {
      setEditName(instance.name);
      setEditDescription(instance.description);
    }
  }, [instance?.instanceId, instance?.name, instance?.description]);

  if (!tool) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Wrench className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Select a tool to view details</p>
        </div>
      </div>
    );
  }

  const config = categoryConfig[tool.category];
  const FallbackIcon = config.icon;
  const isConfiguring = !!instance;

  const handleNameBlur = () => {
    if (instance && onUpdate && editName !== instance.name) {
      onUpdate({ name: editName });
    }
  };

  const handleDescriptionBlur = () => {
    if (instance && onUpdate && editDescription !== instance.description) {
      onUpdate({ description: editDescription });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center min-w-0 gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2',
                config.color,
              )}
            >
              {tool.provider?.svgIcon || tool.provider?.icon || tool.provider?.id ? (
                <ProviderIcon
                  providerId={tool.provider?.id}
                  svgIcon={tool.provider?.svgIcon}
                  icon={tool.provider?.icon}
                  className="w-6 h-6"
                />
              ) : (
                <FallbackIcon className="w-6 h-6" />
              )}
            </div>
            <h3 className="text-base font-semibold truncate">
              {isConfiguring ? instance.name : tool.name}
            </h3>
          </div>
          <div className="flex gap-2 shrink-0">
            {!isConfiguring && onAdd && (
              <Button size="sm" onClick={onAdd}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add
              </Button>
            )}
            {isConfiguring && onRemove && (
              <Button size="sm" variant="destructive" onClick={onRemove}>
                <Trash2 className="w-4 h-4 mr-1.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {isConfiguring && onUpdate && (
            <div className="space-y-4 text-xs bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                <h4 className="text-xs font-medium">Tool Configuration</h4>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tool-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="tool-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleNameBlur}
                  className="text-xs h-7"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tool-description" className="text-xs">
                  Description
                </Label>
                <Textarea
                  id="tool-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  onBlur={handleDescriptionBlur}
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
              {tool.nodeType && (
                <div className="pt-3 space-y-3 border-t">
                  <h5 className="text-xs font-medium text-muted-foreground">Parameters</h5>
                  {paramFields.length > 0 ? (
                    paramFields.map((field) => {
                      const aiChosenModes =
                        (instance.params._aiChosenModes as Record<string, boolean>) ?? {};
                      const isAiChosen = aiChosenModes[field.name] ?? true;
                      return (
                        <ToolParamField
                          key={field.name}
                          field={field}
                          value={instance.params[field.name]}
                          onChange={(value) => {
                            onUpdate({ params: { ...instance.params, [field.name]: value } });
                          }}
                          aiChosen={isAiChosen}
                          onAiChosenChange={(enabled) => {
                            const updatedModes = { ...aiChosenModes, [field.name]: enabled };
                            onUpdate({
                              params: { ...instance.params, _aiChosenModes: updatedModes },
                            });
                          }}
                          onAddCredential={onAddCredential}
                          actionId={tool.nodeType}
                          formValues={instance.params as Record<string, unknown>}
                        />
                      );
                    })
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      This tool has no configurable parameters.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!isConfiguring && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Description</h4>
              <p className="text-sm text-muted-foreground">{tool.description}</p>
            </div>
          )}

          {!isConfiguring && tool.tags && tool.tags.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Tags</h4>
              <div className="flex flex-wrap gap-1.5">
                {tool.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {tool.docsUrl && (
            <div>
              <a
                href={tool.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Documentation
              </a>
            </div>
          )}

          {tool.inputSchema && (
            <div>
              <button
                onClick={() => setShowSchema(!showSchema)}
                className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary"
              >
                {showSchema ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                {isConfiguring ? 'Effective Input Schema' : 'Input Schema'}
              </button>
              {showSchema && (
                <div className="p-3 mt-2 space-y-2 overflow-auto rounded-lg bg-muted/50">
                  {isConfiguring &&
                    effectiveInputSchema &&
                    '_staticParams' in effectiveInputSchema &&
                    (effectiveInputSchema as { _staticParams?: string[] })._staticParams && (
                      <div className="pb-2 mb-2 text-xs border-b text-muted-foreground">
                        <span className="font-medium">Static params (not sent to AI): </span>
                        {(
                          (effectiveInputSchema as { _staticParams?: string[] })._staticParams ?? []
                        ).join(', ')}
                      </div>
                    )}
                  <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
                    {JSON.stringify(
                      isConfiguring ? effectiveInputSchema : tool.inputSchema,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 border-t">
            <div className="text-xs text-muted-foreground">
              Tool ID: <code className="bg-muted px-1 py-0.5 rounded">{tool.id}</code>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
