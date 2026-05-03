/**
 * UserManagementPage — Standalone page for user management.
 *
 * Wraps the existing UserManagement component in a page layout
 * consistent with the Access Control page style. Registered as a
 * plugin route contribution at '/users'.
 */

import { Users } from 'lucide-react';
import { useApiClient, PageLayout } from '@flowlib/ui';
import { UserManagement } from './UserManagement';
import { useAuth } from '../providers/AuthProvider';

export function UserManagementPage() {
  const api = useApiClient();
  const { user, isAuthenticated, isLoading } = useAuth();
  const apiBaseUrl = api.getBaseURL();

  if (isLoading) {
    return (
      <div className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground flex items-center justify-center">
        <p className="text-sm text-fl-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground flex items-center justify-center">
        <p className="text-sm text-fl-muted-foreground">Please sign in to access this page.</p>
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <PageLayout
        title="User Management"
        subtitle="Manage users for your Flowlib instance."
        icon={Users}
      >
        <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-400">
          Only administrators can manage users. Contact an admin for access.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="User Management"
      subtitle="Create, manage, and remove users for your Flowlib instance."
      icon={Users}
    >
      <UserManagement apiBaseUrl={apiBaseUrl} />
    </PageLayout>
  );
}
