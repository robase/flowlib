/**
 * UserButton — avatar trigger with a dropdown of profile + sign-out actions.
 *
 * Visual style cribbed from
 * https://github.com/better-auth-ui/better-auth-ui — header card with avatar,
 * name, email, role chip, then menu items.
 *
 * Uses the @flowlib/ui DropdownMenu primitives so it portals correctly inside
 * the .flowlib CSS scope.
 */

import { LogIn, LogOut, Settings, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@flowlib/ui';
import { useAuth } from '../providers/AuthProvider';
import { useSignOut } from '../hooks';
import { formatAuthRoleLabel } from '../../shared/roles';
import { Avatar } from './ui/Avatar';
import { cn } from '../lib/utils';

export interface UserButtonProps {
  /** Called when the sign-in button is clicked (unauthenticated state) */
  onSignInClick?: () => void;
  className?: string;
}

export function UserButton({ onSignInClick, className }: UserButtonProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  // Run navigate from the mutation callback rather than after `await` so
  // the redirect survives the immediate unmount triggered by AuthGate.
  const signOut = useSignOut({
    onSuccess: () => navigate('/sign-in', { replace: true }),
  });

  if (isLoading) {
    return <div className={cn('h-9 w-9 animate-pulse rounded-full bg-muted', className)} />;
  }

  if (!isAuthenticated || !user) {
    return (
      <button
        type="button"
        onClick={onSignInClick}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground',
          className,
        )}
      >
        <LogIn className="h-4 w-4" />
        Sign in
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full ring-offset-background transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            className,
          )}
          aria-label="Account menu"
        >
          <Avatar src={user.image} name={user.name} email={user.email} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-0">
        <DropdownMenuLabel className="flex items-start gap-3 px-3 py-3">
          <Avatar src={user.image} name={user.name} email={user.email} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name ?? 'User'}</p>
            {user.email && (
              <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
            )}
            {user.role && (
              <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {formatAuthRoleLabel(user.role)}
              </span>
            )}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <div className="p-1">
          <DropdownMenuItem asChild>
            <Link to="/profile" className="cursor-pointer">
              <User className="h-4 w-4" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/profile" className="cursor-pointer">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
        </div>

        <DropdownMenuSeparator />

        <div className="p-1">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              signOut.mutate();
            }}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
