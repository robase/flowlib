/**
 * ProfilePage — settings page for the authenticated user.
 *
 * Two tabs: Details (read-only email, editable first/last name) and
 * Authentication (2FA, API keys, active sessions). Layout follows the
 * project screenshot — left column = title/description, right column =
 * functional UI; rows separated by horizontal rules.
 */

import { useState } from 'react';
import { User as UserIcon } from 'lucide-react';
import { PageLayout } from '@flowlib/ui';
import { useAuth } from '../providers/AuthProvider';
import { DetailsTab } from './profile/DetailsTab';
import { AuthenticationTab } from './profile/AuthenticationTab';
import { TabPanel, Tabs } from './ui/tabs';

export interface ProfilePageProps {
  basePath: string;
}

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'authentication', label: 'Authentication' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function ProfilePage({ basePath }: ProfilePageProps) {
  void basePath;
  const { user, isAuthenticated, isLoading } = useAuth();
  const [active, setActive] = useState<TabKey>('details');

  if (isLoading) {
    return (
      <PageLayout title="Profile" icon={UserIcon}>
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </PageLayout>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <PageLayout title="Profile" icon={UserIcon}>
        <p className="text-sm text-muted-foreground">Please sign in to view your profile.</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Profile"
      subtitle="Manage your account details and authentication."
      icon={UserIcon}
    >
      <div className="flex flex-col gap-8">
        <Tabs<TabKey> tabs={TABS} active={active} onChange={setActive} />

        <TabPanel active={active === 'details'}>
          <DetailsTab />
        </TabPanel>

        <TabPanel active={active === 'authentication'}>
          <AuthenticationTab />
        </TabPanel>
      </div>
    </PageLayout>
  );
}
