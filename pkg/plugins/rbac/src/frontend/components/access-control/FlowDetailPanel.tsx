import { useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, Plus, Workflow } from 'lucide-react';
import { useGrantFlowAccess, useRevokeFlowAccess } from '../../hooks/useFlowAccess';
import { useEffectiveFlowAccess } from '../../hooks/useScopes';
import type { FlowAccessPermission, Team } from '../../../shared/types';
import type { AccessRow, AuthUser, PrincipalSelection } from './types';
import { AccessTable, RoleSelector } from './AccessTable';
import { FormDialog } from './FormDialog';
import { PrincipalCombobox } from './PrincipalCombobox';

export function FlowDetailPanel({
  flowId,
  flowName,
  users,
  userMap,
  teams,
  isAdmin,
}: {
  flowId: string;
  flowName: string;
  users: AuthUser[];
  userMap: Map<string, AuthUser>;
  teams: Team[];
  isAdmin: boolean;
}) {
  const effectiveFlowAccessQuery = useEffectiveFlowAccess(flowId);
  const grantFlowAccess = useGrantFlowAccess(flowId);
  const revokeFlowAccess = useRevokeFlowAccess(flowId);
  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [principalSelections, setPrincipalSelections] = useState<PrincipalSelection[]>([]);
  const [permission, setPermission] = useState<FlowAccessPermission>('viewer');

  const effectiveRecords = effectiveFlowAccessQuery.data?.records ?? [];
  const existingDirectUserIds = new Set(
    effectiveRecords
      .filter((record) => record.source === 'direct' && record.userId)
      .map((record) => record.userId),
  );
  const existingDirectTeamIds = new Set(
    effectiveRecords
      .filter((record) => record.source === 'direct' && record.teamId)
      .map((record) => record.teamId),
  );
  const owningTeam =
    teams.find((team) => team.id === effectiveFlowAccessQuery.data?.scopeId) ?? null;
  const scopePath = useMemo(() => {
    const path: Team[] = [];
    let current = owningTeam;

    while (current) {
      path.unshift(current);
      current = current.parentId
        ? (teams.find((team) => team.id === current?.parentId) ?? null)
        : null;
    }

    return path;
  }, [owningTeam, teams]);

  const accessRows = useMemo(() => {
    const rows: AccessRow[] = effectiveRecords.map((record) => {
      const isUser = !!record.userId;
      const userId = record.userId ?? null;
      const teamId = record.teamId ?? null;

      return {
        id: `${record.source}:${record.id}`,
        label: isUser
          ? userMap.get(userId ?? '')?.name ||
            userMap.get(userId ?? '')?.email ||
            userId ||
            'Unknown'
          : teams.find((team) => team.id === teamId)?.name || teamId || 'Unknown',
        kind: isUser ? 'user' : 'team',
        permission: record.permission,
        source: record.source === 'direct' ? 'Direct grant' : `via ${record.scopeName || 'team'}`,
        group: record.source === 'direct' ? 'Direct' : 'Inherited',
        canRemove: record.source === 'direct' && isAdmin,
        onPermissionChange:
          record.source === 'direct'
            ? (permission) =>
                grantFlowAccess.mutate({
                  ...(userId ? { userId } : teamId ? { teamId } : {}),
                  permission,
                })
            : undefined,
        onRemove: () => revokeFlowAccess.mutate(record.id),
      };
    });

    rows.sort((a, b) => {
      const aIsDirect = a.source === 'Direct grant' ? 1 : 0;
      const bIsDirect = b.source === 'Direct grant' ? 1 : 0;
      return bIsDirect - aIsDirect;
    });

    return rows;
  }, [effectiveRecords, userMap, teams, isAdmin, grantFlowAccess, revokeFlowAccess]);

  const directRows = accessRows.filter((row) => row.group === 'Direct');
  const inheritedRows = accessRows.filter((row) => row.group === 'Inherited');

  const openFlow = () => {
    const path = window.location.pathname;
    const accessIdx = path.lastIndexOf('/access');
    const basePath = accessIdx >= 0 ? path.slice(0, accessIdx) : path;
    window.open(`${basePath}/flow/${flowId}`, '_blank');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 overflow-hidden border-b shrink-0 border-fl-border">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center flex-none w-10 h-10 rounded-xl bg-fl-primary/10 text-fl-primary">
            <Workflow className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 min-w-0 text-base font-semibold truncate">{flowName}</h2>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-fl-muted-foreground">
              <span>Root</span>
              {scopePath.map((team) => (
                <div key={team.id} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  <span>{team.name}</span>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3" />
                <span className="font-medium text-fl-foreground">{flowName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openFlow}
              className="flex items-center gap-1.5 rounded-md border border-fl-border px-3 py-1.5 text-xs font-medium text-fl-muted-foreground transition-colors hover:border-fl-primary/50 hover:text-fl-foreground"
            >
              <ExternalLink className="w-4 h-4" /> Open in Editor
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-fl-muted-foreground">
          All principals with access and how they got it.
        </p>
      </div>

      <div className="flex-1 px-5 py-4 overflow-x-hidden overflow-y-auto">
        <div className="space-y-6">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fl-foreground">Direct Access</h3>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setShowGrantDialog(true)}
                  className="flex items-center gap-1.5 rounded-md border border-fl-border px-3 py-1.5 text-xs font-medium text-fl-muted-foreground transition-colors hover:border-fl-primary/50 hover:text-fl-foreground"
                >
                  <Plus className="w-4 h-4" /> Grant Access
                </button>
              ) : null}
            </div>
            <div className="overflow-hidden border rounded-xl border-fl-border bg-fl-background/40">
              <AccessTable
                rows={directRows}
                isLoading={effectiveFlowAccessQuery.isLoading}
                emptyLabel="No direct access assigned"
              />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fl-foreground">Inherited Access</h3>
            <div className="overflow-hidden border rounded-xl border-fl-border bg-fl-background/40">
              <AccessTable
                rows={inheritedRows}
                isLoading={effectiveFlowAccessQuery.isLoading}
                emptyLabel="No inherited access"
              />
            </div>
          </section>
        </div>
      </div>

      <FormDialog
        open={showGrantDialog}
        onClose={() => setShowGrantDialog(false)}
        title="Grant Flow Access"
      >
        <div className="flex flex-col gap-3">
          <PrincipalCombobox
            users={users}
            teams={teams}
            excludeUserIds={existingDirectUserIds}
            excludeTeamIds={existingDirectTeamIds}
            selections={principalSelections}
            onSelect={setPrincipalSelections}
          />
          <div className="flex items-center gap-2">
            <RoleSelector value={permission} onChange={setPermission} />
            <button
              type="button"
              onClick={() => {
                if (principalSelections.length === 0) {
                  return;
                }
                for (const sel of principalSelections) {
                  grantFlowAccess.mutate({
                    ...(sel.type === 'user' ? { userId: sel.id } : { teamId: sel.id }),
                    permission,
                  });
                }
                setPrincipalSelections([]);
                setShowGrantDialog(false);
              }}
              disabled={principalSelections.length === 0 || grantFlowAccess.isPending}
              className="ml-auto rounded-md bg-fl-primary px-4 py-2 text-sm font-semibold text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
            >
              Grant
            </button>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
