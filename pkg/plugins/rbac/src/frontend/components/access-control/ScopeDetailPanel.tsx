import { useMemo, useState } from 'react';
import { ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@flowlib/ui';
import {
  useAddTeamMember,
  useDeleteTeam,
  useTeam,
  useRemoveTeamMember,
} from '../../hooks/useTeams';
import { useGrantScopeAccess, useRevokeScopeAccess, useScopeAccess } from '../../hooks/useScopes';
import type { FlowAccessPermission, Team } from '../../../shared/types';
import type { AccessRow, AuthUser } from './types';
import { AccessTable, OptionalRoleSelector, RoleSelector } from './AccessTable';
import { FormDialog } from './FormDialog';
import { MemberCombobox } from './MemberCombobox';

export function ScopeDetailPanel({
  scopeId,
  scopeName,
  users,
  userMap,
  teams,
  isAdmin,
}: {
  scopeId: string;
  scopeName: string;
  users: AuthUser[];
  userMap: Map<string, AuthUser>;
  teams: Team[];
  isAdmin: boolean;
}) {
  const scopeQuery = useTeam(scopeId);
  const scopeAccessQuery = useScopeAccess(scopeId);
  const grantScopeAccess = useGrantScopeAccess(scopeId);
  const revokeScopeAccess = useRevokeScopeAccess(scopeId);
  const addTeamMember = useAddTeamMember(scopeId);
  const removeTeamMember = useRemoveTeamMember(scopeId);
  const deleteScope = useDeleteTeam();

  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [showMemberDialog, setShowMemberDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [permission, setPermission] = useState<FlowAccessPermission>('viewer');
  const [grantUserIds, setGrantUserIds] = useState<string[]>([]);
  const [memberUserIds, setMemberUserIds] = useState<string[]>([]);

  const members = scopeQuery.data?.members ?? [];
  const scopeAccess = scopeAccessQuery.data?.access ?? [];
  const existingMemberIds = new Set(members.map((member) => member.userId));
  const existingScopeUserIds = new Set(
    scopeAccess.map((record) => record.userId).filter(Boolean) as string[],
  );
  const teamRoleRecord = scopeAccess.find((record) => record.teamId === scopeId) ?? null;
  const childTeams = teams.filter((team) => team.parentId === scopeId);

  const isLoading = scopeQuery.isLoading || scopeAccessQuery.isLoading;

  const accessRows = useMemo(() => {
    const rows: AccessRow[] = [];
    for (const member of members) {
      const user = userMap.get(member.userId);
      rows.push({
        id: `member:${member.id}`,
        label: user?.name || user?.email || member.userId,
        kind: 'user',
        permission: null,
        source: 'Member',
        group: 'Members',
        canRemove: isAdmin,
        onRemove: () => removeTeamMember.mutate(member.userId),
      });
    }
    for (const record of scopeAccess) {
      if (record.teamId === scopeId) {
        continue;
      }
      const isUser = !!record.userId;
      const userId = record.userId ?? null;
      rows.push({
        id: `access:${record.id}`,
        label: isUser
          ? userMap.get(userId ?? '')?.name ||
            userMap.get(userId ?? '')?.email ||
            userId ||
            'Unknown'
          : teams.find((team) => team.id === record.teamId)?.name || record.teamId || 'Unknown',
        kind: isUser ? 'user' : 'team',
        permission: record.permission,
        source: 'Direct grant',
        group: 'Access Grants',
        canRemove: isAdmin,
        onPermissionChange: userId
          ? (permission) =>
              grantScopeAccess.mutate({
                userId,
                permission,
              })
          : undefined,
        onRemove: () => revokeScopeAccess.mutate(record.id),
      });
    }
    return rows;
  }, [
    members,
    scopeAccess,
    userMap,
    teams,
    isAdmin,
    removeTeamMember,
    grantScopeAccess,
    revokeScopeAccess,
  ]);

  const memberRows = accessRows.filter((row) => row.group === 'Members');
  const _grantRows = accessRows.filter((row) => row.group === 'Access Grants');

  const scopePath = useMemo(() => {
    const path: Team[] = [];
    let current = teams.find((team) => team.id === scopeId) ?? null;
    while (current) {
      path.unshift(current);
      current = current.parentId
        ? (teams.find((team) => team.id === current?.parentId) ?? null)
        : null;
    }
    return path;
  }, [teams, scopeId]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 overflow-hidden border-b shrink-0 border-fl-border">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center flex-none w-10 h-10 rounded-xl bg-fl-primary/10 text-fl-primary">
            <Users className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 min-w-0 text-base font-semibold truncate">{scopeName}</h2>
              {isAdmin ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 rounded-md border border-fl-destructive/30 px-3 py-1.5 text-xs font-medium text-fl-destructive transition-colors hover:bg-fl-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" /> Delete team
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-fl-muted-foreground">
              <span>Root</span>
              {scopePath.map((team) => (
                <div key={team.id} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  <span
                    className={team.id === scopeId ? 'font-medium text-fl-foreground' : undefined}
                  >
                    {team.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="mt-3 text-xs text-fl-muted-foreground">
            Access applies to all flows inside this team and its child teams.
          </p>
        </div>
      </div>

      <div className="flex-1 px-5 py-4 overflow-x-hidden overflow-y-auto">
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-fl-foreground">
                  Team Role on Child Flows
                </h3>
                <p className="mt-0.5 text-xs text-fl-muted-foreground">
                  Base role applied to every flow inside this team.
                </p>
              </div>
              <div className="shrink-0">
                <OptionalRoleSelector
                  value={teamRoleRecord?.permission ?? null}
                  emptyLabel="No team role"
                  onChange={(nextPermission) => {
                    if (nextPermission === null) {
                      if (teamRoleRecord) {
                        revokeScopeAccess.mutate(teamRoleRecord.id);
                      }
                      return;
                    }

                    grantScopeAccess.mutate({
                      teamId: scopeId,
                      permission: nextPermission,
                    });
                  }}
                />
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fl-foreground">Members</h3>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setShowMemberDialog(true)}
                  className="flex items-center gap-1.5 rounded-md border border-fl-border px-3 py-1.5 text-xs font-medium text-fl-muted-foreground transition-colors hover:border-fl-primary/50 hover:text-fl-foreground"
                >
                  <Plus className="w-4 h-4" /> Add Member
                </button>
              ) : null}
            </div>
            <div className="overflow-hidden border rounded-xl border-fl-border bg-fl-background/40">
              <AccessTable rows={memberRows} isLoading={isLoading} emptyLabel="No members" />
            </div>
          </section>

          {childTeams.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-fl-foreground">Sub-teams</h3>
              <div className="space-y-2">
                {childTeams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center gap-2 px-3 py-2 border rounded-xl border-fl-border bg-fl-background/40"
                  >
                    <Users className="w-3.5 h-3.5 text-fl-muted-foreground" />
                    <span className="flex-1 min-w-0 text-sm font-medium truncate text-fl-foreground">
                      {team.name}
                    </span>
                    <span className="text-[11px] text-fl-muted-foreground">Child team</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <FormDialog
        open={showGrantDialog}
        onClose={() => setShowGrantDialog(false)}
        title="Grant Scope Access"
      >
        <div className="flex flex-col gap-3">
          <MemberCombobox
            users={users}
            excludeIds={existingScopeUserIds}
            selectedUserIds={grantUserIds}
            onSelect={setGrantUserIds}
          />
          <div className="flex items-center gap-2">
            <RoleSelector value={permission} onChange={setPermission} />
            <button
              type="button"
              onClick={() => {
                if (grantUserIds.length === 0) {
                  return;
                }
                for (const userId of grantUserIds) {
                  grantScopeAccess.mutate({ userId, permission });
                }
                setGrantUserIds([]);
                setShowGrantDialog(false);
              }}
              disabled={grantUserIds.length === 0 || grantScopeAccess.isPending}
              className="ml-auto rounded-md bg-fl-primary px-4 py-2 text-sm font-semibold text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
            >
              Grant
            </button>
          </div>
        </div>
      </FormDialog>

      <FormDialog
        open={showMemberDialog}
        onClose={() => setShowMemberDialog(false)}
        title="Add Team Member"
      >
        <div className="flex flex-col gap-3">
          <MemberCombobox
            users={users}
            excludeIds={existingMemberIds}
            selectedUserIds={memberUserIds}
            onSelect={setMemberUserIds}
          />
          <button
            type="button"
            onClick={() => {
              if (memberUserIds.length === 0) {
                return;
              }
              for (const userId of memberUserIds) {
                addTeamMember.mutate({ userId });
              }
              setMemberUserIds([]);
              setShowMemberDialog(false);
            }}
            disabled={memberUserIds.length === 0 || addTeamMember.isPending}
            className="rounded-md bg-fl-primary px-4 py-2 text-sm font-semibold text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </FormDialog>

      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
      >
        <DialogContent className="max-w-sm border-fl-border bg-fl-background text-fl-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Delete team</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-fl-muted-foreground">
            Are you sure you want to delete{' '}
            <strong className="text-fl-foreground">{scopeName}</strong>? Flows directly inside this
            team will move to the parent team when one exists, and this team's access grants will be
            removed.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border border-fl-border px-3 py-1.5 text-xs font-medium text-fl-muted-foreground hover:text-fl-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                deleteScope.mutate(scopeId);
                setShowDeleteConfirm(false);
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
