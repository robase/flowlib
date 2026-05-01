/**
 * SidebarUserMenu — user avatar link in the sidebar footer.
 *
 * Clicking navigates to the profile page. Sign-out is on the UserButton
 * dropdown / profile page itself.
 */

import { Link, useLocation } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { Avatar } from './ui/Avatar';
import { cn } from '../lib/utils';

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

  const displayName = user.name ?? user.email ?? 'User';
  // Normalize basePath the same way @flowlib/ui's buildFrontendRoute does:
  // a basePath of `/` (root-mounted hosting) collapses to `''` so we don't
  // produce `//profile` — which the browser interprets as protocol-relative.
  const normalizedBase = !basePath || basePath === '/' ? '' : basePath.replace(/\/$/, '');
  const profilePath = `${normalizedBase}/profile`;
  const isActive = location.pathname === profilePath;

  return (
    <Link
      to={profilePath}
      title={`${displayName}${user.role ? ` — ${user.role}` : ''}`}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/60',
        isActive && 'bg-accent/60',
        collapsed && 'justify-center',
      )}
    >
      <Avatar src={user.image} name={user.name} email={user.email} size="md" />
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          {user.role && (
            <p className="truncate text-xs capitalize text-muted-foreground">{user.role}</p>
          )}
        </div>
      )}
    </Link>
  );
}
