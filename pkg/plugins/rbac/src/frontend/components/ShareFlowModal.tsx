/**
 * ShareFlowModal — Modal for managing flow access permissions.
 *
 * Shows current access records and allows granting/revoking access.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Share2, Users as UsersIcon, X } from 'lucide-react';
import { useFlowAccess, useGrantFlowAccess, useRevokeFlowAccess } from '../hooks/useFlowAccess';
import { useTeams } from '../hooks/useTeams';
import { useRbac } from '../providers/RbacProvider';
import { PrincipalCombobox } from './access-control/PrincipalCombobox';
import { useUsers } from './access-control/useUsers';
import type { PrincipalSelection } from './access-control/types';
import type { FlowAccessPermission } from '../../shared/types';

const AVATAR_COLORS = [
  'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  'bg-orange-500/15 text-orange-600 dark:text-orange-400',
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getPermissionColor(permission: FlowAccessPermission): string {
  switch (permission) {
    case 'owner':
      return 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400';
    case 'editor':
      return 'border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400';
    case 'operator':
      return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400';
    case 'viewer':
    default:
      return 'border-fl-border bg-fl-muted/50 text-fl-muted-foreground';
  }
}

const PERMISSION_OPTIONS: Array<{ value: FlowAccessPermission; label: string }> = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'operator', label: 'Operator' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner' },
];

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

interface ShareFlowModalProps {
  flowId: string;
  onClose: () => void;
}

export function ShareFlowModal({ flowId, onClose }: ShareFlowModalProps) {
  const { user } = useRbac();
  const { data, isLoading } = useFlowAccess(flowId);
  const grantAccess = useGrantFlowAccess(flowId);
  const revokeAccess = useRevokeFlowAccess(flowId);

  const users = useUsers();
  const teamsQuery = useTeams();
  const teams = teamsQuery.data?.teams ?? [];

  const userMap = useMemo(() => {
    const map = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const teamMap = useMemo(() => {
    const map = new Map<string, (typeof teams)[number]>();
    for (const t of teams) {
      map.set(t.id, t);
    }
    return map;
  }, [teams]);

  const [selections, setSelections] = useState<PrincipalSelection[]>([]);
  const [newPermission, setNewPermission] = useState<FlowAccessPermission>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [openRoleDropdown, setOpenRoleDropdown] = useState<string | null>(null);

  const accessRecords = data?.access ?? [];

  const existingUserIds = useMemo(
    () => new Set(accessRecords.filter((r) => r.userId).map((r) => r.userId)),
    [accessRecords],
  );
  const existingTeamIds = useMemo(
    () => new Set(accessRecords.filter((r) => r.teamId).map((r) => r.teamId)),
    [accessRecords],
  );

  const resolveLabel = (userId: string | null | undefined, teamId: string | null | undefined) => {
    if (userId) {
      const u = userMap.get(userId);
      return u?.name || u?.email || userId;
    }
    if (teamId) {
      return teamMap.get(teamId)?.name || teamId;
    }
    return '?';
  };

  const handleGrant = async () => {
    if (selections.length === 0) {
      setError('Select at least one user or team');
      return;
    }

    setError(null);
    try {
      for (const sel of selections) {
        await grantAccess.mutateAsync({
          ...(sel.type === 'user' ? { userId: sel.id } : { teamId: sel.id }),
          permission: newPermission,
        });
      }
      setSelections([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant access');
    }
  };

  const handleRevoke = async (accessId: string) => {
    try {
      await revokeAccess.mutateAsync(accessId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access');
    }
  };

  const handleChangeRole = async (
    accessId: string,
    record: (typeof accessRecords)[0],
    newRole: FlowAccessPermission,
  ) => {
    try {
      await grantAccess.mutateAsync({
        ...(record.userId
          ? { userId: record.userId }
          : record.teamId
            ? { teamId: record.teamId }
            : {}),
        permission: newRole,
      });
      setOpenRoleDropdown(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-fl-border bg-fl-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fl-foreground">Share Flow</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-fl-muted-foreground transition-colors hover:bg-fl-muted hover:text-fl-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Current access records */}
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fl-muted-foreground">
            People with access
          </h3>
          {isLoading ? (
            <div className="py-4 text-center text-sm text-fl-muted-foreground">Loading...</div>
          ) : accessRecords.length === 0 ? (
            <div className="py-4 text-center text-sm text-fl-muted-foreground">
              No flow-specific access records yet.
            </div>
          ) : (
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {accessRecords.map((record) => {
                const isUser = !!record.userId;
                const principalId = record.userId ?? record.teamId ?? '?';
                const label = resolveLabel(record.userId, record.teamId);
                const secondary = isUser ? userMap.get(record.userId ?? '')?.email : undefined;
                const isCurrentUser = record.userId === user?.id;
                const isRoleDropdownOpen = openRoleDropdown === record.id;

                return (
                  <div
                    key={record.id}
                    className="flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-fl-muted/30"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${getAvatarColor(principalId)}`}
                      >
                        {isUser ? label[0]?.toUpperCase() : <UsersIcon className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-fl-foreground">
                            {label}
                          </span>
                          {isCurrentUser && (
                            <span className="font-normal text-xs text-fl-muted-foreground">
                              (you)
                            </span>
                          )}
                        </div>
                        {secondary && secondary !== label && (
                          <div className="truncate text-xs text-fl-muted-foreground">
                            {secondary}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="relative">
                      {isCurrentUser ? (
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${getPermissionColor(record.permission)}`}
                        >
                          {record.permission}
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenRoleDropdown(isRoleDropdownOpen ? null : record.id)
                            }
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors hover:bg-fl-muted/50 ${getPermissionColor(record.permission)}`}
                          >
                            {record.permission}
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          {isRoleDropdownOpen && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setOpenRoleDropdown(null)}
                              />
                              <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-fl-border bg-fl-background py-1 shadow-lg">
                                {PERMISSION_OPTIONS.map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    className={`w-full px-3 py-1.5 text-left text-xs ${
                                      record.permission === opt.value
                                        ? 'bg-fl-muted font-medium text-fl-foreground'
                                        : 'text-fl-foreground hover:bg-fl-muted/50'
                                    }`}
                                    onClick={() => handleChangeRole(record.id, record, opt.value)}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                                <div className="my-1 border-t border-fl-border" />
                                <button
                                  type="button"
                                  className="w-full px-3 py-1.5 text-left text-xs text-fl-destructive hover:bg-fl-destructive/10"
                                  onClick={() => {
                                    handleRevoke(record.id);
                                    setOpenRoleDropdown(null);
                                  }}
                                >
                                  Remove access
                                </button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Grant new access */}
        <div className="border-t border-fl-border pt-4">
          <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-fl-muted-foreground">
            Add people
          </h3>
          <div className="flex flex-col gap-2">
            <PrincipalCombobox
              users={users}
              teams={teams}
              excludeUserIds={existingUserIds}
              excludeTeamIds={existingTeamIds}
              selections={selections}
              onSelect={setSelections}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const idx = PERMISSION_OPTIONS.findIndex((o) => o.value === newPermission);
                  const next = PERMISSION_OPTIONS[(idx + 1) % PERMISSION_OPTIONS.length];
                  setNewPermission(next.value);
                }}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${getPermissionColor(newPermission)}`}
              >
                {newPermission}
              </button>
              <button
                onClick={handleGrant}
                disabled={grantAccess.isPending || selections.length === 0}
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-fl-primary px-3.5 py-1.5 text-sm font-medium text-fl-primary-foreground transition-colors hover:bg-fl-primary/90 disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
