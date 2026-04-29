/**
 * SidebarUserMenu — User avatar link in the sidebar footer.
 *
 * Clicking navigates directly to the profile page.
 * Sign-out is available on the profile page itself.
 */

import { Link, useLocation } from 'react-router';
import { useAuth } from '../providers/AuthProvider';

export interface SidebarUserMenuProps {
  collapsed?: boolean;
  basePath?: string;
}

export function SidebarUserMenu({ collapsed = false, basePath = '' }: SidebarUserMenuProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading || !isAuthenticated || !user) {
    return null;
  }

  const initials = (user.name ?? user.email ?? user.id)[0]?.toUpperCase() ?? '?';
  const displayName = user.name ?? user.email ?? 'User';
  // Normalize basePath the same way @flowlib/ui's buildFrontendRoute does:
  // a basePath of `/` (root-mounted hosting) collapses to `''`, so we don't
  // produce `//profile` — which the browser interprets as the protocol-
  // relative URL `http://profile/`.
  const normalizedBase = !basePath || basePath === '/' ? '' : basePath.replace(/\/$/, '');
  const profilePath = `${normalizedBase}/profile`;
  const isActive = location.pathname === profilePath;

  return (
    <Link
      to={profilePath}
      title={`${displayName}${user.role ? ` — ${user.role}` : ''}`}
      className={[
        'flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors',
        'hover:bg-imp-muted/60',
        isActive ? 'bg-imp-muted/60' : '',
        collapsed ? 'justify-center' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-imp-primary/10 text-sm font-medium text-imp-primary">
        {user.image ? (
          <img src={user.image} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
        ) : (
          initials
        )}
      </div>

      {/* Name + role (only when expanded) */}
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          {user.role && (
            <p className="truncate text-xs capitalize text-imp-muted-foreground">{user.role}</p>
          )}
        </div>
      )}
    </Link>
  );
}
