/**
 * UserMenuSection — Sidebar footer component showing current user info.
 *
 * Displays the authenticated user's name and role in the sidebar footer area.
 * This is a standalone component — not directly injected via plugin system
 * but available for host apps to use in custom sidebar layouts.
 */

import { useRbac } from '../providers/RbacProvider';

export function UserMenuSection({ collapsed = false }: { collapsed?: boolean }) {
  const { user, isAuthenticated, isLoading } = useRbac();

  if (isLoading || !isAuthenticated || !user) {
    return null;
  }

  const initials = (user.name ?? user.id)[0]?.toUpperCase() ?? '?';

  if (collapsed) {
    return (
      <div
        className="flex justify-center px-2 py-2"
        title={`${user.name ?? user.id} (${user.role ?? 'user'})`}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-fl-primary/10 text-xs font-medium text-fl-primary">
          {initials}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-fl-primary/10 text-xs font-medium text-fl-primary">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.name ?? user.id}</p>
        <p className="truncate text-xs text-fl-muted-foreground capitalize">
          {user.role ?? 'user'}
        </p>
      </div>
    </div>
  );
}

export function UserAvatar({ className }: { className?: string }) {
  const { user, isAuthenticated } = useRbac();

  if (!isAuthenticated || !user) {
    return null;
  }

  const initials = (user.name ?? user.id)[0]?.toUpperCase() ?? '?';

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-fl-primary/10 text-xs font-medium text-fl-primary ${className ?? 'h-6 w-6'}`}
      title={user.name ?? user.id}
    >
      {initials}
    </div>
  );
}
