/**
 * ProfilePage — Standalone page for the current authenticated user.
 *
 * Shows basic account information and provides a sign-out action.
 */

import { LogOut, Mail, Shield, User as UserIcon } from 'lucide-react';
import { PageLayout } from '@flowlib/ui';
import { useAuth } from '../providers/AuthProvider';
import { TwoFactorSetup } from './TwoFactorSetup';
import { formatAuthRoleLabel } from '../../shared/roles';

export interface ProfilePageProps {
  basePath: string;
}

export function ProfilePage({ basePath }: ProfilePageProps) {
  void basePath;
  const { user, isAuthenticated, isLoading, signOut } = useAuth();

  if (isLoading) {
    return (
      <div className="imp-page flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-imp-background text-imp-foreground">
        <p className="text-sm text-imp-muted-foreground">Loading profile…</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="imp-page flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-imp-background text-imp-foreground">
        <p className="text-sm text-imp-muted-foreground">Please sign in to view your profile.</p>
      </div>
    );
  }

  const displayName = user.name ?? user.email ?? user.id;
  const initials = displayName[0]?.toUpperCase() ?? '?';

  return (
    <PageLayout
      title="Profile"
      subtitle="View your account details and manage your current session."
      icon={UserIcon}
    >
      <div className="max-w-2xl rounded-xl border border-imp-border bg-imp-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-imp-primary/10 text-lg font-semibold text-imp-primary">
            {user.image ? (
              <img src={user.image} alt={displayName} className="h-16 w-16 object-cover" />
            ) : (
              initials
            )}
          </div>

          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-imp-foreground">{displayName}</p>
            <p className="truncate text-sm text-imp-muted-foreground">{user.email ?? user.id}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-imp-border bg-imp-background p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-imp-foreground">
              <UserIcon className="h-4 w-4 text-imp-muted-foreground" />
              Name
            </div>
            <p className="text-sm text-imp-muted-foreground">{user.name ?? 'Not set'}</p>
          </div>

          <div className="rounded-lg border border-imp-border bg-imp-background p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-imp-foreground">
              <Mail className="h-4 w-4 text-imp-muted-foreground" />
              Email
            </div>
            <p className="text-sm text-imp-muted-foreground">{user.email ?? 'Not available'}</p>
          </div>

          <div className="rounded-lg border border-imp-border bg-imp-background p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-imp-foreground">
              <Shield className="h-4 w-4 text-imp-muted-foreground" />
              Role
            </div>
            <p className="text-sm text-imp-muted-foreground">{formatAuthRoleLabel(user.role)}</p>
          </div>

          <div className="rounded-lg border border-imp-border bg-imp-background p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-imp-foreground">
              <UserIcon className="h-4 w-4 text-imp-muted-foreground" />
              User ID
            </div>
            <p className="break-all text-sm text-imp-muted-foreground">{user.id}</p>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <div className="mt-4">
          <TwoFactorSetup />
        </div>

        <div className="mt-6 flex justify-end border-t border-imp-border pt-4">
          <button
            onClick={async () => {
              await signOut();
            }}
            className="inline-flex items-center gap-2 rounded-md border border-imp-border px-4 py-2 text-sm font-medium text-imp-foreground transition-colors hover:bg-imp-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>
    </PageLayout>
  );
}
