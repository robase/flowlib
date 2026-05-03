import React, { memo, useMemo, useState, useEffect } from 'react';
import { Button } from '../ui/button';

import { ScrollArea } from '../ui/scroll-area';
import { ProviderIcon } from '../shared/ProviderIcon';
import type { ToolDefinition, AddedToolInstance, ToolCategory } from '../nodes/ToolSelectorModal';
import type { NodeSidebarProps } from './NodeSidebar';
import {
  Search,
  Plus,
  X,
  Check,
  Database,
  Globe,
  Code2,
  Wrench,
  Sparkles,
  ArrowLeft,
  ChevronRight,
  PanelLeftClose,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Shared helpers ────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const toolCategoryConfig: Record<
  ToolCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  data: { label: 'Data', icon: Database, color: 'text-blue-400 border-blue-500/30' },
  web: { label: 'Web', icon: Globe, color: 'text-sky-400 border-sky-500/30' },
  code: {
    label: 'Code',
    icon: Code2,
    color: 'text-purple-400 border-purple-500/30',
  },
  utility: {
    label: 'Utility',
    icon: Wrench,
    color: 'text-orange-400 border-orange-500/30',
  },
  custom: {
    label: 'Custom',
    icon: Sparkles,
    color: 'text-pink-400 border-pink-500/30',
  },
};

const toolIconDiamondClass =
  'flex shrink-0 items-center justify-center border bg-card rotate-45 rounded-[0.45rem]';
const toolIconGlyphClass = '-rotate-45';

const toolCategoryIcons: Record<ToolCategory, React.ElementType> = {
  data: Database,
  web: Globe,
  code: Code2,
  utility: Wrench,
  custom: Sparkles,
};

const toolCategoryOrder: ToolCategory[] = ['data', 'web', 'code', 'utility', 'custom'];

// ─── ActionsSidebar ────────────────────────────────────────────────

export function ActionsSidebar({
  onClose,
  onCollapse,
  availableTools = [],
  addedTools = [],
  onAddTool,
  onRemoveTool,
  onSelectTool,
  selectedInstanceId,
}: NodeSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const debouncedSearch = useDebounce(searchQuery, 300);

  const isSearching = searchQuery.trim().length > 0;

  const toggleGroup = (providerId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const _addedToolIds = useMemo(() => new Set(addedTools.map((t) => t.toolId)), [addedTools]);

  const filteredTools = useMemo(() => {
    let tools = availableTools.filter(
      (tool) => tool.provider?.id !== 'triggers' && !tool.id.startsWith('trigger.'),
    );
    if (selectedCategory !== 'all') {
      tools = tools.filter((t) => t.category === selectedCategory);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      tools = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q),
      );
    }
    return tools;
  }, [availableTools, debouncedSearch, selectedCategory]);

  const { toolProviderGroups, sortedToolProviderIds } = useMemo(() => {
    const byProvider: Record<
      string,
      { name: string; icon?: string; svgIcon?: string; tools: ToolDefinition[] }
    > = {};
    for (const tool of filteredTools) {
      const providerId = tool.provider?.id ?? tool.category;
      if (!byProvider[providerId]) {
        byProvider[providerId] = {
          name: tool.provider?.name ?? toolCategoryConfig[tool.category]?.label ?? tool.category,
          icon: tool.provider?.icon,
          svgIcon: tool.provider?.svgIcon,
          tools: [],
        };
      }
      byProvider[providerId].tools.push(tool);
    }

    const pOrder = ['core', 'ai', 'logic', 'data', 'utility', 'io'];
    const sorted = Object.keys(byProvider).sort((a, b) => {
      const idxA = pOrder.indexOf(a);
      const idxB = pOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) {
        return idxA - idxB;
      }
      if (idxA !== -1) {
        return -1;
      }
      if (idxB !== -1) {
        return 1;
      }
      return byProvider[a].name.localeCompare(byProvider[b].name);
    });

    return { toolProviderGroups: byProvider, sortedToolProviderIds: sorted };
  }, [filteredTools]);

  const categoryCounts = useMemo(() => {
    const c: Record<ToolCategory | 'all', number> = {
      all: 0,
      data: 0,
      web: 0,
      code: 0,
      utility: 0,
      custom: 0,
    };
    for (const t of availableTools) {
      if (t.provider?.id === 'triggers' || t.id.startsWith('trigger.')) {
        continue;
      }
      c.all++;
      c[t.category]++;
    }
    return c;
  }, [availableTools]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden border-r w-96 border-border bg-fl-background text-card-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="p-0 w-7 h-7"
              onClick={onClose}
              title="Back to Nodes"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          <div>
            <h2 className="text-sm font-semibold text-card-foreground">Agent Actions</h2>
            <p className="text-[10px] text-muted-foreground">Add actions to this agent</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {addedTools.length > 0 && (
            <span className="flex items-center justify-center w-5 h-5 text-xs rounded-full bg-primary/10 text-primary">
              {addedTools.length}
            </span>
          )}
          {onCollapse && (
            <Button
              variant="ghost"
              size="sm"
              className="p-0 w-7 h-7 text-muted-foreground hover:text-foreground"
              onClick={onCollapse}
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pt-3 pb-2 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          <input
            type="text"
            placeholder="Search actions…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-transparent pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute -translate-y-1/2 right-3 top-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 pb-1 overflow-x-auto">
          <Button
            size="sm"
            variant={selectedCategory === 'all' ? 'default' : 'ghost'}
            onClick={() => setSelectedCategory('all')}
            className="shrink-0 h-6 px-2 text-[10px]"
          >
            All ({categoryCounts.all})
          </Button>
          {toolCategoryOrder.map((cat) => {
            const cfg = toolCategoryConfig[cat];
            const CatIcon = cfg.icon;
            const count = categoryCounts[cat];
            if (count === 0) {
              return null;
            }
            return (
              <Button
                key={cat}
                size="sm"
                variant={selectedCategory === cat ? 'default' : 'ghost'}
                onClick={() => setSelectedCategory(cat)}
                className="shrink-0 gap-1 h-6 px-2 text-[10px]"
              >
                <CatIcon className="w-3 h-3" />
                {cfg.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Added Actions section – pinned above scroll */}
      {addedTools.length > 0 && (
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <h3 className="mb-2 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            Added ({addedTools.length})
          </h3>
          <div className="space-y-1 pr-2 overflow-y-auto max-h-[210px]">
            {addedTools.map((instance) => {
              const toolDef = availableTools.find((t) => t.id === instance.toolId);
              return (
                <AddedToolChip
                  key={instance.instanceId}
                  instance={instance}
                  toolDef={toolDef}
                  isActive={selectedInstanceId === instance.instanceId}
                  onSelect={() => onSelectTool?.(instance)}
                  onRemove={() => onRemoveTool?.(instance.instanceId)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Content — grouped by provider */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-3 space-y-4">
          {filteredTools.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-20" />
              <p className="text-xs">No actions found</p>
            </div>
          ) : (
            sortedToolProviderIds.map((providerId) => {
              const group = toolProviderGroups[providerId];
              const isCollapsed = isSearching ? false : !expandedGroups.has(providerId);
              return (
                <div key={providerId}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(providerId)}
                    className="flex items-center gap-1.5 mb-2 w-full text-[11px] font-semibold tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight
                      className={cn(
                        'w-3 h-3 shrink-0 transition-transform duration-200',
                        !isCollapsed && 'rotate-90',
                      )}
                    />
                    <ProviderIcon
                      providerId={providerId}
                      svgIcon={group.svgIcon}
                      icon={group.icon}
                      className="w-4 h-4"
                    />
                    <span className="flex-1 text-left">{group.name}</span>
                    <span className="text-[10px] font-normal tabular-nums">
                      {group.tools.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-1.5">
                      {group.tools.map((tool) => (
                        <ToolCard key={tool.id} tool={tool} onAdd={() => onAddTool?.(tool.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Tool Card ─────────────────────────────────────────────────────

const ToolCard = memo(function ToolCard({
  tool,
  onAdd,
}: {
  tool: ToolDefinition;
  onAdd: () => void;
}) {
  const cfg = toolCategoryConfig[tool.category];
  const FallbackIcon = cfg.icon;

  return (
    <div
      className="relative flex items-center gap-2.5 p-2.5 transition-all border rounded-lg cursor-pointer group border-border bg-fl-card hover:border-muted-foreground/50 hover:bg-muted/50"
      onClick={onAdd}
    >
      <div className={cn('h-8 w-8', toolIconDiamondClass, cfg.color)}>
        {tool.provider?.svgIcon || tool.provider?.icon || tool.provider?.id ? (
          <ProviderIcon
            providerId={tool.provider?.id}
            svgIcon={tool.provider?.svgIcon}
            icon={tool.provider?.icon}
            className={cn('w-5 h-5', toolIconGlyphClass)}
          />
        ) : (
          <FallbackIcon className={cn('w-5 h-5', toolIconGlyphClass)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{tool.name}</div>
        <p className="overflow-hidden text-xs text-muted-foreground line-clamp-1 text-ellipsis">
          {tool.description}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="w-6 h-6 p-0 transition-opacity opacity-0 shrink-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
      >
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
});

// ─── Added Tool Chip ───────────────────────────────────────────────

const AddedToolChip = memo(function AddedToolChip({
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
  const [confirming, setConfirming] = useState(false);
  const category = toolDef?.category ?? 'utility';
  const cfg = toolCategoryConfig[category];
  const FallbackIcon = toolCategoryIcons[category];

  return (
    <div
      className={cn(
        'group relative flex items-center gap-1.5 px-2 py-1 rounded-md border cursor-pointer transition-all text-xs',
        confirming
          ? 'border-destructive/50 bg-destructive/5'
          : isActive
            ? 'border-primary bg-primary/10 ring-1 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30',
      )}
      onClick={confirming ? undefined : onSelect}
    >
      {confirming ? null : (
        <div className={cn('h-5 w-5', toolIconDiamondClass, cfg.color)}>
          {toolDef?.provider?.svgIcon || toolDef?.provider?.icon || toolDef?.provider?.id ? (
            <ProviderIcon
              providerId={toolDef?.provider?.id}
              svgIcon={toolDef?.provider?.svgIcon}
              icon={toolDef?.provider?.icon}
              className={cn('w-3 h-3', toolIconGlyphClass)}
            />
          ) : (
            <FallbackIcon className={cn('w-3 h-3', toolIconGlyphClass)} />
          )}
        </div>
      )}
      {confirming ? (
        <>
          <span className="flex-1 truncate text-destructive">Remove?</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex items-center justify-center w-4 h-4 rounded-full shrink-0 bg-destructive/20 text-destructive hover:bg-destructive/30"
            title="Confirm remove"
          >
            <Check className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
            className="flex items-center justify-center w-4 h-4 rounded-full shrink-0 hover:bg-muted text-muted-foreground"
            title="Cancel"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </>
      ) : (
        <>
          <div
            className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded', cfg.color)}
          >
            {toolDef?.provider?.svgIcon || toolDef?.provider?.icon || toolDef?.provider?.id ? (
              <ProviderIcon
                providerId={toolDef?.provider?.id}
                svgIcon={toolDef?.provider?.svgIcon}
                icon={toolDef?.provider?.icon}
                className="w-3 h-3"
              />
            ) : (
              <FallbackIcon className="w-3 h-3" />
            )}
          </div>
          <span className="flex-1 truncate">{instance.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            className="flex items-center justify-center w-4 h-4 transition-opacity rounded-full opacity-0 shrink-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
            title="Remove action"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </>
      )}
    </div>
  );
});
