import { useCallback, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  FolderInput,
  GripVertical,
  Plus,
  Search,
  Shield,
  Users,
  Workflow,
} from 'lucide-react';
import { PageLayout } from '@flowlib/ui';
import { useRbac } from '../../providers/RbacProvider';
import { useTeams, useCreateTeam } from '../../hooks/useTeams';
import { useScopeTree, usePreviewMove } from '../../hooks/useScopes';
import type { FlowSummary, ScopeTreeNode } from '../../../shared/types';
import type { AuthUser, SelectedItem } from './types';
import { formatPermissionLabel, getPermissionBadgeClasses } from './types';
import { useUsers } from './useUsers';
import { ScopeDetailPanel } from './ScopeDetailPanel';
import { FlowDetailPanel } from './FlowDetailPanel';
import { MoveConfirmationDialog } from './MoveConfirmationDialog';
import {
  useAccessControlStore,
  canDropOnTarget,
  collectScopeIds,
  type HierarchyDragItem,
} from '../../stores/accessControlStore';

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function findScopeNode(scopes: ScopeTreeNode[], scopeId: string): ScopeTreeNode | null {
  for (const scope of scopes) {
    if (scope.id === scopeId) {
      return scope;
    }
    const child = findScopeNode(scope.children, scopeId);
    if (child) {
      return child;
    }
  }
  return null;
}

function filterScopes(scopes: ScopeTreeNode[], query: string): ScopeTreeNode[] {
  return scopes.reduce<ScopeTreeNode[]>((acc, scope) => {
    const matchesScope =
      scope.name.toLowerCase().includes(query) ||
      (scope.description?.toLowerCase().includes(query) ?? false);
    const matchingChildren = filterScopes(scope.children, query);
    const matchingFlows = scope.flows.filter((flow) => flow.name.toLowerCase().includes(query));

    if (matchesScope || matchingChildren.length > 0 || matchingFlows.length > 0) {
      acc.push({ ...scope, children: matchingChildren, flows: matchingFlows });
    }
    return acc;
  }, []);
}

function findSelectedName(
  scopes: ScopeTreeNode[],
  flows: FlowSummary[],
  selected: SelectedItem | null,
): string | null {
  if (!selected) {
    return null;
  }

  if (selected.kind === 'team') {
    return findScopeNode(scopes, selected.id)?.name ?? selected.name;
  }

  const stack = [...flows];
  const scopeStack = [...scopes];
  while (scopeStack.length > 0) {
    const current = scopeStack.pop();
    if (!current) {
      break;
    }
    stack.push(...current.flows);
    scopeStack.push(...current.children);
  }
  return stack.find((flow) => flow.id === selected.id)?.name ?? selected.name;
}

// ─── FlowTreeRow ──────────────────────────────────────────────────────────────

function FlowTreeRow({
  flow,
  isSelected,
  onSelect,
}: {
  flow: FlowSummary;
  isSelected: boolean;
  onSelect: (flow: FlowSummary) => void;
}) {
  const { draggedItem, startDrag, endDrag } = useAccessControlStore();
  const isDragging = draggedItem?.type === 'flow' && draggedItem.id === flow.id;

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        startDrag({ type: 'flow', id: flow.id, name: flow.name, parentId: flow.scopeId ?? null });
      }}
      onDragEnd={endDrag}
      onClick={() => onSelect(flow)}
      className={clsx(
        'group flex cursor-pointer items-center gap-2 rounded-md px-4 py-1.5 transition-colors',
        'hover:bg-imp-muted/50',
        isDragging && 'opacity-40',
        isSelected && 'bg-imp-primary/10 text-imp-primary ring-1 ring-imp-primary/30',
      )}
    >
      <Workflow
        className={clsx(
          'h-4 w-4 shrink-0',
          isSelected ? 'text-imp-primary' : 'text-imp-muted-foreground',
        )}
      />
      <span className="flex-1 min-w-0 text-sm font-medium truncate">{flow.name}</span>
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-imp-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

// ─── ScopeTreeRow ─────────────────────────────────────────────────────────────

function ScopeTreeRow({
  scope,
  allScopes,
  depth,
  onSelectScope,
  onSelectFlow,
  onTriggerMove,
}: {
  scope: ScopeTreeNode;
  allScopes: ScopeTreeNode[];
  depth: number;
  onSelectScope: (scope: ScopeTreeNode) => void;
  onSelectFlow: (flow: FlowSummary) => void;
  onTriggerMove: (item: HierarchyDragItem, targetId: string | null) => void;
}) {
  const {
    draggedItem,
    dropTarget,
    selected,
    expandedNodes,
    startDrag,
    endDrag,
    setDropTarget,
    toggleNode,
  } = useAccessControlStore();

  const isExpanded = expandedNodes.has(scope.id);
  const isSelected = selected?.kind === 'team' && selected.id === scope.id;
  const isDragging = draggedItem?.type === 'scope' && draggedItem.id === scope.id;
  const hasChildren = scope.children.length > 0 || scope.flows.length > 0;

  const canDrop = draggedItem !== null && canDropOnTarget(draggedItem, scope.id, allScopes);
  const isDropTarget = dropTarget === scope.id && canDrop;

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedItem || !canDrop) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (dropTarget !== scope.id) {
      setDropTarget(scope.id);
    }
  };

  // Use relatedTarget to avoid clearing the drop highlight when entering a child node.
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) {
      return;
    }
    if (dropTarget === scope.id) {
      setDropTarget(null);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedItem || !canDrop) {
      return;
    }
    onTriggerMove(draggedItem, scope.id);
  };

  return (
    <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          startDrag({
            type: 'scope',
            id: scope.id,
            name: scope.name,
            parentId: scope.parentId ?? null,
          });
        }}
        onDragEnd={endDrag}
        onClick={() => onSelectScope(scope)}
        className={clsx(
          'group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition-colors',
          isDragging && 'opacity-40',
          isDropTarget && 'ring-2 ring-imp-primary/40 bg-imp-primary/5',
          isSelected ? 'text-imp-primary ring-1 ring-imp-primary/30' : 'hover:bg-accent',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleNode(scope.id);
            }}
            className="rounded p-0.5 text-imp-muted-foreground hover:bg-imp-muted"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Users
          className={clsx(
            'h-4 w-4 shrink-0',
            isSelected ? 'text-imp-primary' : 'text-imp-muted-foreground',
          )}
        />
        <span className="flex-1 min-w-0 text-sm font-medium truncate">{scope.name}</span>
        {scope.teamPermission ? (
          <span
            className={clsx(
              'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
              getPermissionBadgeClasses(scope.teamPermission),
            )}
          >
            {formatPermissionLabel(scope.teamPermission)}
          </span>
        ) : null}
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-imp-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {isExpanded ? (
        <div className="space-y-1 border-l border-imp-border" style={{ marginLeft: '22px' }}>
          {scope.flows.map((flow) => (
            <FlowTreeRow
              key={flow.id}
              flow={flow}
              isSelected={selected?.kind === 'flow' && selected.id === flow.id}
              onSelect={onSelectFlow}
            />
          ))}
          {scope.children.map((child) => (
            <ScopeTreeRow
              key={child.id}
              scope={child}
              allScopes={allScopes}
              depth={depth + 1}
              onSelectScope={onSelectScope}
              onSelectFlow={onSelectFlow}
              onTriggerMove={onTriggerMove}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_SCOPES: ScopeTreeNode[] = [];
const EMPTY_FLOWS: FlowSummary[] = [];

export function AccessControlPage() {
  const { isAuthenticated, checkPermission } = useRbac();
  const isAdmin = isAuthenticated && checkPermission('admin:*');

  const users = useUsers();
  const userMap = useMemo(() => {
    const map = new Map<string, AuthUser>();
    for (const user of users) {
      map.set(user.id, user);
    }
    return map;
  }, [users]);

  const teamsQuery = useTeams();
  const teams = teamsQuery.data?.teams ?? [];
  const scopeTreeQuery = useScopeTree();
  const createTeam = useCreateTeam();
  const previewMove = usePreviewMove();

  const {
    selected,
    setSelected,
    search,
    setSearch,
    expandedNodes,
    expandAll,
    showNewTeam,
    setShowNewTeam,
    newTeamName,
    setNewTeamName,
    draggedItem,
    dropTarget,
    setDropTarget,
    endDrag,
    pendingMove,
    setPendingMove,
    movePreview,
    setMovePreview,
    moveError,
    setMoveError,
    clearMove,
  } = useAccessControlStore();

  const scopes = scopeTreeQuery.data?.scopes ?? EMPTY_SCOPES;
  const unscopedFlows = scopeTreeQuery.data?.unscopedFlows ?? EMPTY_FLOWS;

  // Auto-expand everything when tree first loads
  useEffect(() => {
    if (scopes.length > 0 && expandedNodes.size === 0) {
      expandAll(collectScopeIds(scopes));
    }
  }, [scopes]); // expanding on load — intentionally tracks scopes only

  useEffect(() => {
    scopeTreeQuery.refetch();
  }, []); // fires once on mount

  const normalizedSearch = search.trim().toLowerCase();
  const filteredScopes = useMemo(
    () => (normalizedSearch ? filterScopes(scopes, normalizedSearch) : scopes),
    [scopes, normalizedSearch],
  );
  const filteredUnscopedFlows = useMemo(
    () =>
      normalizedSearch
        ? unscopedFlows.filter((f) => f.name.toLowerCase().includes(normalizedSearch))
        : unscopedFlows,
    [unscopedFlows, normalizedSearch],
  );

  const selectedName = useMemo(
    () => findSelectedName(scopes, unscopedFlows, selected),
    [scopes, unscopedFlows, selected],
  );

  const hasTreeItems = filteredScopes.length > 0 || filteredUnscopedFlows.length > 0;

  // Called when a valid drop lands on a target scope (or null = root)
  const handleTriggerMove = useCallback(
    async (item: HierarchyDragItem, targetScopeId: string | null) => {
      endDrag();

      if (!canDropOnTarget(item, targetScopeId, scopes)) {
        return;
      }

      setPendingMove({ type: item.type, id: item.id, name: item.name, targetScopeId });
      setMovePreview(null);
      setMoveError(null);

      try {
        const preview = await previewMove.mutateAsync({
          type: item.type,
          id: item.id,
          targetScopeId,
        });
        setMovePreview(preview);
      } catch (err) {
        setMoveError(err instanceof Error ? err.message : 'Failed to preview move');
      }
    },
    [scopes, endDrag, previewMove, setPendingMove, setMovePreview, setMoveError],
  );

  if (!isAuthenticated) {
    return (
      <PageLayout
        title="Access Control"
        subtitle="Manage team hierarchy and flow-level access grants."
        icon={Shield}
      >
        <p className="text-sm text-imp-muted-foreground">Please sign in to access this page.</p>
      </PageLayout>
    );
  }

  const isLoading = scopeTreeQuery.isLoading;

  return (
    <PageLayout
      title="Access Control"
      subtitle="Manage team hierarchy and flow-level access grants."
      icon={Shield}
    >
      {/* Search + New Team */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute w-3.5 h-3.5 pointer-events-none left-3 top-1/2 -translate-y-1/2 text-imp-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search teams and flows…"
            className="w-full py-2 pr-3 text-sm border rounded-lg outline-none pl-9 border-imp-border bg-imp-background placeholder:text-imp-muted-foreground focus:border-imp-primary/50"
          />
        </div>
        {isAdmin ? (
          showNewTeam ? (
            <div className="ml-auto flex items-center gap-1.5">
              <input
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                placeholder="Team name"
                className="px-2.5 py-2 text-sm border rounded-lg border-imp-border bg-imp-background"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newTeamName.trim()) {
                    createTeam.mutate({ name: newTeamName.trim() });
                    setNewTeamName('');
                    setShowNewTeam(false);
                  }
                  if (event.key === 'Escape') {
                    setShowNewTeam(false);
                    setNewTeamName('');
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!newTeamName.trim()) {
                    return;
                  }
                  createTeam.mutate({ name: newTeamName.trim() });
                  setNewTeamName('');
                  setShowNewTeam(false);
                }}
                disabled={!newTeamName.trim()}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewTeam(false);
                  setNewTeamName('');
                }}
                className="px-3 py-2 text-sm rounded-lg text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewTeam(true)}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" /> New Team
            </button>
          )
        ) : null}
      </div>

      {/* Two-pane layout */}
      <div
        className="grid h-[calc(100vh-220px)] min-h-130 border rounded-lg overflow-hidden"
        style={{ gridTemplateColumns: '320px 1fr' }}
      >
        {/* Left: hierarchy tree */}
        <div className="flex flex-col overflow-hidden bg-imp-muted/20">
          <div
            className="flex-1 px-1 py-2 overflow-y-auto"
            onDragOver={(event) => {
              if (!draggedItem) {
                return;
              }
              // Root-level drop zone: only activate when not over a child scope row
              if (dropTarget === null) {
                event.preventDefault();
                setDropTarget('root');
              }
            }}
            onDragLeave={(event) => {
              const related = event.relatedTarget as Node | null;
              if (related && event.currentTarget.contains(related)) {
                return;
              }
              if (dropTarget === 'root') {
                setDropTarget(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!draggedItem) {
                return;
              }
              handleTriggerMove(draggedItem, null);
            }}
          >
            <div
              className={clsx(
                'min-h-full rounded-lg py-1 transition-colors',
                dropTarget === 'root'
                  ? 'bg-imp-primary/5 ring-1 ring-imp-primary/20 ring-inset'
                  : '',
              )}
            >
              {isLoading ? (
                <div className="flex items-center justify-center px-4 py-12 text-sm text-center text-imp-muted-foreground">
                  Loading hierarchy…
                </div>
              ) : !hasTreeItems ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <FolderInput className="w-10 h-10 mb-3 opacity-30 text-imp-muted-foreground" />
                  <h3 className="text-base font-medium text-imp-foreground">
                    {normalizedSearch ? 'No matching teams or flows' : 'No teams or flows yet'}
                  </h3>
                  <p className="max-w-sm mt-2 text-sm text-imp-muted-foreground">
                    {normalizedSearch
                      ? 'Adjust the search to find a team or flow in the hierarchy.'
                      : 'Create a team to start organizing flows and access scopes.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredUnscopedFlows.map((flow) => (
                    <FlowTreeRow
                      key={flow.id}
                      flow={flow}
                      isSelected={selected?.kind === 'flow' && selected.id === flow.id}
                      onSelect={(nextFlow) =>
                        setSelected({ kind: 'flow', id: nextFlow.id, name: nextFlow.name })
                      }
                    />
                  ))}

                  {filteredScopes.map((scope) => (
                    <ScopeTreeRow
                      key={scope.id}
                      scope={scope}
                      allScopes={scopes}
                      depth={0}
                      onSelectScope={(nextScope) =>
                        setSelected({ kind: 'team', id: nextScope.id, name: nextScope.name })
                      }
                      onSelectFlow={(nextFlow) =>
                        setSelected({ kind: 'flow', id: nextFlow.id, name: nextFlow.name })
                      }
                      onTriggerMove={handleTriggerMove}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: detail panel */}
        <aside className="flex flex-col overflow-hidden border-l border-imp-border bg-imp-muted/30">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center text-imp-muted-foreground">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-imp-primary/5">
                <Shield className="w-6 h-6 text-imp-primary/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-imp-foreground">Select a team or flow</p>
                <p className="mt-1.5 text-xs text-imp-muted-foreground max-w-[280px]">
                  Choose an item from the tree to manage its members and permissions.
                </p>
              </div>
              {hasTreeItems ? null : isAdmin ? (
                <button
                  type="button"
                  onClick={() => setShowNewTeam(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-imp-border px-3 py-1.5 text-xs font-medium text-imp-foreground transition-colors hover:border-imp-primary/50 hover:bg-imp-muted/50"
                >
                  <Plus className="h-3.5 w-3.5" /> Create your first team
                </button>
              ) : null}
            </div>
          ) : selected.kind === 'team' ? (
            <ScopeDetailPanel
              scopeId={selected.id}
              scopeName={selectedName ?? selected.name}
              users={users}
              userMap={userMap}
              teams={teams}
              isAdmin={!!isAdmin}
            />
          ) : (
            <FlowDetailPanel
              flowId={selected.id}
              flowName={selectedName ?? selected.name}
              users={users}
              userMap={userMap}
              teams={teams}
              isAdmin={!!isAdmin}
            />
          )}
        </aside>
      </div>

      {pendingMove ? (
        <MoveConfirmationDialog
          pendingMove={pendingMove}
          preview={movePreview}
          error={moveError}
          onClose={clearMove}
        />
      ) : null}
    </PageLayout>
  );
}
