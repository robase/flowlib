/**
 * TeamsPage — Team management page with create/edit/delete teams and member management.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Search, Trash2, User, Users, X } from 'lucide-react';
import { useApiClient, PageLayout, Skeleton } from '@flowlib/ui';
import { useRbac } from '../providers/RbacProvider';
import {
  useTeams,
  useTeam,
  useCreateTeam,
  useDeleteTeam,
  useAddTeamMember,
  useRemoveTeamMember,
} from '../hooks/useTeams';

// ─────────────────────────────────────────────────────────────
// User fetching (reused from AccessControlPage pattern)
// ─────────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  name?: string;
  email?: string;
}

function useUsers() {
  const api = useApiClient();
  const [users, setUsers] = useState<AuthUser[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api.getBaseURL()}/plugins/auth/users?limit=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.users) {
          setUsers(data.users);
        }
      })
      .catch(() => {
        // intentionally ignored — UI will show empty state
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { users };
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export function TeamsPage() {
  const { isAuthenticated, isLoading: isAuthLoading, checkPermission } = useRbac();
  const teamsQuery = useTeams();
  const createTeam = useCreateTeam();
  const deleteTeam = useDeleteTeam();
  const { users } = useUsers();

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');

  const teams = teamsQuery.data?.teams ?? [];
  const isAdmin = isAuthenticated && checkPermission('admin:*');

  const userMap = useMemo(() => {
    const map = new Map<string, AuthUser>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) {
      return teams;
    }
    return teams.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
    );
  }, [teams, teamSearch]);

  const handleCreate = async () => {
    if (!newTeamName.trim()) {
      return;
    }
    await createTeam.mutateAsync({
      name: newTeamName.trim(),
      description: newTeamDescription.trim() || undefined,
    });
    setNewTeamName('');
    setNewTeamDescription('');
    setShowCreateForm(false);
  };

  const handleDelete = async (teamId: string) => {
    await deleteTeam.mutateAsync(teamId);
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-0 overflow-y-auto fl-page bg-fl-background text-fl-foreground">
        <p className="text-sm text-fl-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-0 overflow-y-auto fl-page bg-fl-background text-fl-foreground">
        <p className="text-sm text-fl-muted-foreground">Please sign in to access this page.</p>
      </div>
    );
  }

  return (
    <PageLayout
      title="Teams"
      icon={Users}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-fl-muted-foreground">
            {filteredTeams.length} team{filteredTeams.length !== 1 ? 's' : ''}
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-fl-primary text-fl-primary-foreground hover:bg-fl-primary/90"
            >
              <Plus className="w-3 h-3" />
              New Team
            </button>
          )}
        </div>
      }
    >
      {/* Create team form */}
      {showCreateForm && (
        <div className="p-3 border rounded-lg border-fl-border bg-fl-card">
          <div className="mb-2 text-xs font-medium text-fl-foreground">Create Team</div>
          <div className="space-y-2">
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name"
              className="w-full rounded border border-fl-border bg-fl-background px-2 py-1.5 text-sm placeholder:text-fl-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreate();
                }
              }}
            />
            <input
              type="text"
              value={newTeamDescription}
              onChange={(e) => setNewTeamDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded border border-fl-border bg-fl-background px-2 py-1.5 text-sm placeholder:text-fl-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreate();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={createTeam.isPending || !newTeamName.trim()}
                className="px-3 py-1 text-xs font-medium rounded bg-fl-primary text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
              >
                {createTeam.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1 text-xs rounded text-fl-muted-foreground hover:text-fl-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fl-muted-foreground" />
        <input
          value={teamSearch}
          onChange={(e) => setTeamSearch(e.target.value)}
          placeholder="Search teams…"
          className="w-full rounded-lg border border-fl-border bg-transparent py-2 pl-9 pr-3 text-sm outline-none placeholder:text-fl-muted-foreground focus:border-fl-primary/50"
        />
      </div>

      {/* Teams list */}
      <div className="border rounded-lg border-fl-border bg-fl-card">
        {teamsQuery.isLoading ? (
          <div className="divide-y divide-fl-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="h-3.5 w-3.5 shrink-0" />
                <Skeleton className="h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : teamsQuery.error ? (
          <div className="px-4 py-8 text-sm text-center text-red-500">
            {teamsQuery.error instanceof Error ? teamsQuery.error.message : 'Failed to load teams'}
          </div>
        ) : filteredTeams.length === 0 ? (
          <div className="px-4 py-8 text-sm text-center text-fl-muted-foreground">
            {teamSearch
              ? 'No teams match this search.'
              : 'No teams yet. Create one to get started.'}
          </div>
        ) : (
          <div className="divide-y divide-fl-border">
            {filteredTeams.map((team) => {
              const isExpanded = expandedTeamId === team.id;
              return (
                <div key={team.id}>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      type="button"
                      className="flex items-center flex-1 gap-3 text-left transition-opacity hover:opacity-80"
                      onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fl-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fl-muted-foreground" />
                      )}
                      <Users className="h-3.5 w-3.5 shrink-0 text-fl-primary" />
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{team.name}</span>
                        {team.description && (
                          <span className="block text-xs truncate text-fl-muted-foreground">
                            {team.description}
                          </span>
                        )}
                      </div>
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDelete(team.id)}
                        className="p-1 rounded shrink-0 text-fl-muted-foreground hover:text-red-500"
                        title="Delete team"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <TeamMembersPanel
                      teamId={team.id}
                      users={users}
                      userMap={userMap}
                      isAdmin={!!isAdmin}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// ─────────────────────────────────────────────────────────────
// Team members panel (inline, shown when a team is expanded)
// ─────────────────────────────────────────────────────────────

function TeamMembersPanel({
  teamId,
  users,
  userMap,
  isAdmin,
}: {
  teamId: string;
  users: AuthUser[];
  userMap: Map<string, AuthUser>;
  isAdmin: boolean;
}) {
  const { data, isLoading } = useTeam(teamId);
  const addMember = useAddTeamMember(teamId);
  const removeMember = useRemoveTeamMember(teamId);

  const members = data?.members ?? [];
  const existingUserIds = new Set(members.map((m) => m.userId));

  const getUserLabel = (userId: string) => {
    const u = userMap.get(userId);
    return u?.name || u?.email || userId;
  };

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!selectedUserId) {
      return;
    }
    await addMember.mutateAsync({ userId: selectedUserId });
    setSelectedUserId(null);
  };

  const handleRemove = async (userId: string) => {
    await removeMember.mutateAsync(userId);
  };

  return (
    <div className="px-3 pt-2 pb-3 border-t border-fl-border bg-fl-muted/20">
      {isLoading ? (
        <div className="space-y-1 py-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1">
              <Skeleton className="h-5 w-5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-32 flex-1" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <p className="py-2 text-xs text-fl-muted-foreground">No members yet.</p>
      ) : (
        <div className="mb-2 space-y-1">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-2 px-2 py-1 text-xs rounded">
              <div className="flex items-center justify-center w-5 h-5 rounded-full shrink-0 bg-fl-primary/10">
                <User className="w-3 h-3 text-fl-primary" />
              </div>
              <span className="flex-1 min-w-0 truncate">{getUserLabel(member.userId)}</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleRemove(member.userId)}
                  className="shrink-0 rounded p-0.5 text-fl-muted-foreground hover:text-red-500"
                  title="Remove member"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center gap-1.5">
          <MemberSearchCombobox
            users={users}
            excludeIds={existingUserIds}
            selectedUserId={selectedUserId}
            onSelect={setSelectedUserId}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={addMember.isPending || !selectedUserId}
            className="shrink-0 rounded bg-fl-primary px-2.5 py-1 text-xs font-medium text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
          >
            {addMember.isPending ? '…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Member search combobox
// ─────────────────────────────────────────────────────────────

function MemberSearchCombobox({
  users,
  excludeIds,
  selectedUserId,
  onSelect,
}: {
  users: AuthUser[];
  excludeIds: Set<string>;
  selectedUserId: string | null;
  onSelect: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedUser = selectedUserId ? users.find((u) => u.id === selectedUserId) : null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter((u) => {
      if (excludeIds.has(u.id)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      );
    });
  }, [users, excludeIds, query]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      {selectedUser ? (
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
          className="flex w-full items-center gap-1.5 rounded border border-fl-border bg-fl-background px-2 py-1 text-xs text-left"
        >
          <User className="w-3 h-3 shrink-0 text-fl-muted-foreground" />
          <span className="flex-1 min-w-0 truncate">
            {selectedUser.name || selectedUser.email || selectedUser.id}
          </span>
          <X className="w-3 h-3 shrink-0 text-fl-muted-foreground" />
        </button>
      ) : (
        <div className="relative">
          <Search className="absolute w-3 h-3 -translate-y-1/2 pointer-events-none left-2 top-1/2 text-fl-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) {
                setOpen(true);
              }
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search users…"
            className="w-full py-1 pl-6 pr-2 text-xs border rounded border-fl-border bg-fl-background placeholder:text-fl-muted-foreground"
          />
        </div>
      )}

      {open && !selectedUser && (
        <div className="absolute left-0 z-50 w-full mt-1 border rounded-md shadow-lg top-full border-fl-border bg-fl-background">
          <div className="py-1 overflow-y-auto max-h-40">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fl-muted-foreground">No users found.</p>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    onSelect(u.id);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-fl-muted/50 transition-colors"
                >
                  <User className="h-3.5 w-3.5 shrink-0 text-fl-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">{u.name || u.email || u.id}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
