import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Search, Plus, X, ChevronRight, Boxes } from 'lucide-react';
import { Button } from '../../../ui/button';
import { ScrollArea } from '../../../ui/scroll-area';
import { Skeleton } from '../../../ui/skeleton';
import { useNodeRegistry } from '../../../../contexts/NodeRegistryContext';
import type { NodeDefinition } from '../../../../types/node-definition.types';
import { ProviderIcon } from '../../../shared/ProviderIcon';
import { useFlowEditorStore } from '../../flow-editor.store';
import { useUIStore } from '../../../../stores/uiStore';
import { cn } from '../../../../lib/utils';
import type { SidebarSection, SidebarSectionContext } from '../types';

interface NodesSectionArgs {
  onAddNode: (type: string) => void;
}

export function createNodesSection(args: NodesSectionArgs): SidebarSection {
  return {
    id: 'nodes',
    title: 'Nodes',
    icon: Boxes,
    render: (ctx) => <NodesSectionBody onAddNode={args.onAddNode} ctx={ctx} />,
  };
}

interface NodesSectionBodyProps {
  onAddNode: (type: string) => void;
  ctx: SidebarSectionContext;
}

function NodesSectionBody({ onAddNode, ctx }: NodesSectionBodyProps) {
  const [search, setSearch] = useState('');
  const { isLoading, nodeDefinitions } = useNodeRegistry();
  const expandedGroups = useUIStore((s) => s.nodeSidebarExpandedGroups);
  const toggleNodeSidebarGroup = useUIStore((s) => s.toggleNodeSidebarGroup);
  const navigate = useNavigate();
  const location = useLocation();
  const isInspectMode = location.pathname.includes('/runs');

  // In inspect mode the editable canvas isn't mounted, so calling onAddNode
  // would silently no-op (the registered add handler lives inside
  // FlowWorkbenchView, which isn't mounted on /runs). Instead, bounce to the
  // editor route with `?addNode=<type>` and let FlowEditor consume the param
  // on mount and add the node there.
  const handleAdd = (type: string) => {
    if (isInspectMode) {
      const editPath = `${ctx.basePath ?? ''}/flow/${ctx.flowId}`;
      navigate(`${editPath}?addNode=${encodeURIComponent(type)}`);
      return;
    }
    onAddNode(type);
  };

  const isSearching = search.trim().length > 0;

  const toggleGroup = (providerId: string) => {
    toggleNodeSidebarGroup(providerId);
  };

  const getNodeSortRank = (providerId: string, node: NodeDefinition) => {
    if (providerId === 'core') {
      if (node.type === 'core.agent') {
        return 0;
      }
      if (node.type === 'core.model') {
        return 1;
      }
    }
    return 2;
  };

  const { providerGroups } = useMemo(() => {
    const lowerSearch = search.toLowerCase();

    const filtered = nodeDefinitions.filter((n) => {
      if (n.hidden) {
        return false;
      }
      if (search) {
        return (
          n.label.toLowerCase().includes(lowerSearch) ||
          n.description.toLowerCase().includes(lowerSearch)
        );
      }
      return true;
    });

    const byProvider: Record<
      string,
      { name: string; icon?: string; svgIcon?: string; nodes: NodeDefinition[] }
    > = {};
    for (const node of filtered) {
      const providerId = node.provider?.id ?? 'other';
      if (!byProvider[providerId]) {
        byProvider[providerId] = {
          name: node.provider?.name ?? 'Other',
          icon: node.provider?.icon,
          svgIcon: node.provider?.svgIcon,
          nodes: [],
        };
      }
      byProvider[providerId].nodes.push(node);
    }

    for (const [providerId, group] of Object.entries(byProvider)) {
      group.nodes.sort((a, b) => {
        const rankDiff = getNodeSortRank(providerId, a) - getNodeSortRank(providerId, b);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return a.label.localeCompare(b.label);
      });
    }

    return { providerGroups: byProvider };
  }, [nodeDefinitions, search]);

  const providerOrder = ['triggers', 'core', 'ai', 'logic', 'data', 'io'];
  const sortedProviderIds = useMemo(
    () =>
      Object.keys(providerGroups).sort((a, b) => {
        const idxA = providerOrder.indexOf(a);
        const idxB = providerOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) {
          return idxA - idxB;
        }
        if (idxA !== -1) {
          return -1;
        }
        if (idxB !== -1) {
          return 1;
        }
        return providerGroups[a].name.localeCompare(providerGroups[b].name);
      }),
    [providerGroups],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-0">
        <div className="px-3 pt-2 pb-2">
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
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 pt-2 pb-2 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          <input
            type="text"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-transparent pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute -translate-y-1/2 right-3 top-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-3 space-y-4">
          {sortedProviderIds.map((providerId) => {
            const group = providerGroups[providerId];
            const isCollapsed = isSearching ? false : !expandedGroups.includes(providerId);
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
                  <span className="text-[10px] font-normal tabular-nums">{group.nodes.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1.5">
                    {group.nodes.map((node) => (
                      <NodeCard key={node.type} node={node} onAddNode={handleAdd} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {sortedProviderIds.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-20" />
              <p className="text-xs">No nodes found matching &ldquo;{search}&rdquo;</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function NodeCard({
  node,
  onAddNode,
}: {
  node: NodeDefinition;
  onAddNode: (type: string) => void;
}) {
  const bgColor =
    node.provider?.id === 'core' || node.provider?.id === 'triggers'
      ? 'bg-accent text-primary'
      : 'bg-muted text-muted-foreground';

  const storeNodes = useFlowEditorStore((s) => s.nodes);
  const isAtLimit = useMemo(() => {
    if (node.maxInstances === null || node.maxInstances === undefined) {
      return false;
    }
    const count = storeNodes.filter(
      (n) => (n.data as Record<string, unknown>)?.type === node.type,
    ).length;
    return count >= node.maxInstances;
  }, [node.maxInstances, node.type, storeNodes]);

  return (
    <div
      className={cn(
        'relative flex items-center gap-2.5 p-2.5 transition-all border rounded-lg group border-border bg-fl-card',
        isAtLimit
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-grab active:cursor-grabbing hover:border-muted-foreground/50 hover:bg-muted/50',
      )}
      onClick={() => !isAtLimit && onAddNode(node.type)}
      draggable={!isAtLimit}
      onDragStart={(e) => {
        if (isAtLimit) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/flowlib-node-type', node.type);
        // Plain-text fallback for environments that strip custom MIME types.
        e.dataTransfer.setData('text/plain', node.type);
      }}
      title={
        isAtLimit ? `Only ${node.maxInstances} ${node.label} allowed per flow` : node.description
      }
    >
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', bgColor)}>
        <ProviderIcon
          providerId={node.provider?.id}
          svgIcon={node.provider?.svgIcon}
          icon={node.icon}
          className="w-5 h-5"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{node.label}</div>
        <p className="overflow-hidden text-xs text-muted-foreground line-clamp-1 text-ellipsis">
          {isAtLimit ? 'Already added to flow' : node.description}
        </p>
      </div>
      {!isAtLimit && (
        <Button
          size="sm"
          variant="ghost"
          className="w-6 h-6 p-0 transition-opacity opacity-0 shrink-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onAddNode(node.type);
          }}
        >
          <Plus className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}
