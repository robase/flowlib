import { Move, User, Users, X } from 'lucide-react';
import { useMoveFlow } from '../../hooks/useScopes';
import { useUpdateTeam } from '../../hooks/useTeams';
import type { MovePreviewResponse } from '../../../shared/types';
import type { PendingMove } from './types';
import { getPermissionBadgeClasses } from './types';

export function MoveConfirmationDialog({
  pendingMove,
  preview,
  error,
  onClose,
}: {
  pendingMove: PendingMove | null;
  preview: MovePreviewResponse | null;
  error: string | null;
  onClose: () => void;
}) {
  const moveFlow = useMoveFlow(pendingMove?.type === 'flow' ? pendingMove.id : '');
  const reparentScope = useUpdateTeam(pendingMove?.type === 'scope' ? pendingMove.id : '');

  const isSubmitting = moveFlow.isPending || reparentScope.isPending;

  const handleConfirm = async () => {
    if (!pendingMove) {
      return;
    }
    if (pendingMove.type === 'flow') {
      await moveFlow.mutateAsync(pendingMove.targetScopeId);
    } else {
      await reparentScope.mutateAsync({ parentId: pendingMove.targetScopeId });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/35">
      <div className="w-full max-w-lg rounded-xl border border-fl-border bg-fl-background shadow-[var(--fl-shadow-floating)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-fl-border">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-fl-foreground">
              <Move className="w-4 h-4 text-fl-primary" />
              Confirm Move
            </div>
            <p className="mt-1 text-xs text-fl-muted-foreground">
              Review the access impact before applying this hierarchy change.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-fl-muted-foreground hover:text-fl-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm">
          {error ? (
            <div className="px-3 py-2 text-red-700 border border-red-300 rounded-lg bg-red-50 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
              {error}
            </div>
          ) : !preview ? (
            <div className="px-3 py-4 text-center border rounded-lg border-fl-border bg-fl-card text-fl-muted-foreground">
              Calculating impact…
            </div>
          ) : (
            <>
              <div className="px-3 py-3 border rounded-lg border-fl-border bg-fl-card">
                <div className="font-medium text-fl-foreground">
                  Move "{preview.item.name}" to{' '}
                  {preview.target.path.length > 0 ? preview.target.path.join(' / ') : 'Top level'}
                </div>
                <div className="mt-1 text-xs text-fl-muted-foreground">
                  {preview.affectedFlows} flow{preview.affectedFlows === 1 ? '' : 's'} affected
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium tracking-wider uppercase text-fl-muted-foreground">
                  Access Changes
                </div>
                <div className="p-2 space-y-1 overflow-y-auto border rounded-lg max-h-56 border-fl-border bg-fl-card">
                  {preview.accessChanges.gained.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-fl-muted-foreground">
                      No new principals gain access from this move.
                    </div>
                  ) : (
                    preview.accessChanges.gained.map((entry) => (
                      <div
                        key={`${entry.source}-${entry.name}`}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                      >
                        <div className="flex items-center justify-center w-6 h-6 rounded-full shrink-0 bg-fl-primary/10">
                          {entry.userId ? (
                            <User className="w-3 h-3 text-fl-primary" />
                          ) : (
                            <Users className="w-3 h-3 text-fl-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{entry.name}</div>
                          <div className="truncate text-[10px] text-fl-muted-foreground">
                            {entry.source}
                          </div>
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getPermissionBadgeClasses(entry.permission)}`}
                        >
                          {entry.permission}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-2 text-xs text-fl-muted-foreground">
                  {preview.accessChanges.unchanged} access grant
                  {preview.accessChanges.unchanged === 1 ? '' : 's'} remain unchanged.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-fl-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-fl-border px-3 py-1.5 text-sm text-fl-muted-foreground hover:text-fl-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!preview || isSubmitting || !!error}
            className="rounded bg-fl-primary px-3 py-1.5 text-sm font-medium text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? 'Applying…' : `Move ${pendingMove?.type === 'scope' ? 'Team' : 'Flow'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
