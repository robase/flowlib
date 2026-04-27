import { Fragment, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Trash2, User, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@flowlib/ui';
import { twMerge } from 'tailwind-merge';
import type { AccessRow } from './types';
import type { FlowAccessPermission } from '../../../shared/types';
import { getPermissionBadgeClasses } from './types';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const ROLE_OPTIONS: Array<{
  value: FlowAccessPermission;
  label: string;
  description: string;
}> = [
  { value: 'viewer', label: 'Viewer', description: 'Can inspect the flow.' },
  { value: 'operator', label: 'Operator', description: 'Can inspect and run the flow.' },
  { value: 'editor', label: 'Editor', description: 'Can inspect, run, and edit the flow.' },
  { value: 'owner', label: 'Owner', description: 'Can edit and manage sharing.' },
];

export function RoleSelector({
  value,
  onChange,
}: {
  value: FlowAccessPermission;
  onChange: (permission: FlowAccessPermission) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex w-full items-center justify-between gap-1 rounded-md border px-2.5 py-1.5 text-sm font-medium capitalize',
            getPermissionBadgeClasses(value),
          )}
        >
          <span className="truncate">{value}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Select role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ROLE_OPTIONS.map((role) => (
          <DropdownMenuItem
            key={role.value}
            onSelect={() => onChange(role.value)}
            className={cn(
              'items-start gap-0 px-2 py-2',
              value === role.value && 'bg-accent text-accent-foreground',
            )}
          >
            <div className="min-w-0 text-left">
              <div className="text-sm font-medium">{role.label}</div>
              <div className="text-xs text-muted-foreground">{role.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OptionalRoleSelector({
  value,
  onChange,
  emptyLabel = 'No direct access',
}: {
  value: FlowAccessPermission | null;
  onChange: (permission: FlowAccessPermission | null) => void;
  emptyLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex w-40 items-center justify-between gap-1 rounded-md border px-2.5 py-1.5 text-sm font-medium capitalize',
            value
              ? getPermissionBadgeClasses(value)
              : 'border-imp-border text-imp-muted-foreground hover:bg-imp-muted/50',
          )}
        >
          <span className="truncate">{value ?? emptyLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Set access level</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onChange(null)}
          className={cn('px-2 py-2 text-sm', value === null && 'bg-accent text-accent-foreground')}
        >
          {emptyLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ROLE_OPTIONS.map((role) => (
          <DropdownMenuItem
            key={role.value}
            onSelect={() => onChange(role.value)}
            className={cn(
              'items-start gap-0 px-2 py-2',
              value === role.value && 'bg-accent text-accent-foreground',
            )}
          >
            <div className="min-w-0 text-left">
              <div className="text-sm font-medium">{role.label}</div>
              <div className="text-xs text-muted-foreground">{role.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccessTable({
  rows,
  isLoading,
  emptyLabel,
}: {
  rows: AccessRow[];
  isLoading: boolean;
  emptyLabel: string;
}) {
  const [pendingRemovalRow, setPendingRemovalRow] = useState<AccessRow | null>(null);

  const removalDialogCopy = pendingRemovalRow
    ? pendingRemovalRow.group === 'Members'
      ? {
          title: 'Remove team member',
          body: `Remove "${pendingRemovalRow.label}" from team?`,
          confirmLabel: 'Remove member',
        }
      : {
          title: pendingRemovalRow.kind === 'team' ? 'Revoke team access' : 'Revoke user access',
          body:
            pendingRemovalRow.kind === 'team'
              ? `Remove direct access for ${pendingRemovalRow.label}?`
              : `Remove direct access for ${pendingRemovalRow.label}?`,
          confirmLabel: 'Remove access',
        }
    : null;

  if (isLoading) {
    return <div className="px-2 py-4 text-sm text-center text-imp-muted-foreground">Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="px-2 py-4 text-sm text-center text-imp-muted-foreground">{emptyLabel}</div>
    );
  }

  const groups: Array<{ label: string; rows: AccessRow[] }> = [];
  for (const row of rows) {
    const groupLabel = row.group ?? '';
    const existing = groups.find((g) => g.label === groupLabel);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.push({ label: groupLabel, rows: [row] });
    }
  }
  const hasGroups = groups.length > 1;

  return (
    <>
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col />
          <col className="w-36" />
          <col className="w-10" />
        </colgroup>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.label || '_default'}>
              {hasGroups && group.label && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-imp-muted-foreground"
                  >
                    {group.label}
                  </td>
                </tr>
              )}
              {group.rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={cn(
                    'hover:bg-imp-muted/20',
                    rowIndex > 0 && 'border-t border-imp-border',
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                          row.kind === 'user' ? 'bg-imp-primary/10' : 'bg-imp-muted',
                        )}
                      >
                        {row.kind === 'user' ? (
                          <User className="h-3.5 w-3.5 text-imp-primary" />
                        ) : (
                          <Users className="h-3.5 w-3.5 text-imp-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{row.label}</span>
                          {row.kind === 'team' && (
                            <span className="shrink-0 rounded border border-imp-border px-1.5 py-0.5 text-[11px] font-medium text-imp-muted-foreground">
                              Team
                            </span>
                          )}
                        </div>
                        {row.source && row.source !== 'Direct grant' && row.source !== 'Member' && (
                          <span className="text-[11px] text-imp-muted-foreground">
                            {row.source}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {row.permission ? (
                      row.onPermissionChange ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex w-32 items-center justify-between gap-1 rounded-full border px-2.5 py-1 text-xs font-medium capitalize hover:bg-imp-muted/50',
                                getPermissionBadgeClasses(row.permission),
                              )}
                              title={row.source}
                            >
                              <span className="truncate">{row.permission}</span>
                              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuLabel className="text-xs">
                              Change access role
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {ROLE_OPTIONS.map((role) => (
                              <DropdownMenuItem
                                key={role.value}
                                onSelect={() => row.onPermissionChange?.(role.value)}
                                className={cn(
                                  'items-start gap-0 px-2 py-2',
                                  row.permission === role.value &&
                                    'bg-accent text-accent-foreground',
                                )}
                              >
                                <div className="min-w-0 text-left">
                                  <div className="text-sm font-medium">{role.label}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {role.description}
                                  </div>
                                </div>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex w-32 justify-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
                            getPermissionBadgeClasses(row.permission),
                          )}
                          title={row.source}
                        >
                          {row.permission}
                        </span>
                      )
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {row.canRemove && row.onRemove ? (
                      <button
                        type="button"
                        onClick={() => setPendingRemovalRow(row)}
                        className="p-1 rounded text-imp-muted-foreground hover:bg-imp-destructive/10 hover:text-imp-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <Dialog
        open={!!pendingRemovalRow}
        onOpenChange={(open) => !open && setPendingRemovalRow(null)}
      >
        <DialogContent className="max-w-sm border-imp-border bg-imp-background text-imp-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{removalDialogCopy?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-imp-muted-foreground">{removalDialogCopy?.body}</p>
          <DialogFooter className="justify-between w-full sm:gap-2">
            <button
              type="button"
              onClick={() => setPendingRemovalRow(null)}
              className="rounded-md mr-auto border border-imp-border px-3 py-1.5 text-xs font-medium text-imp-muted-foreground hover:text-imp-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                pendingRemovalRow?.onRemove?.();
                setPendingRemovalRow(null);
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              {removalDialogCopy?.confirmLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
