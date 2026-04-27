/**
 * @flowlib/user-auth — Auth Frontend Plugin Definition
 *
 * Registers the auth plugin's frontend contributions:
 * - App shell: AuthProvider + AuthGate (sign-in page when unauthenticated)
 * - Sidebar item: "Users" (admin-only)
 * - Sidebar footer: User avatar + sign-out menu
 * - Routes: /users → UserManagementPage, /profile → ProfilePage
 */

import { Users } from 'lucide-react';
import { ProfilePage } from '../components/ProfilePage';
import { UserManagementPage } from '../components/UserManagementPage';
import { SidebarUserMenu } from '../components/SidebarUserMenu';
import { AuthAppShell } from '../components/AuthAppShell';
import type { InvectFrontendPlugin } from '@flowlib/ui';

export const authFrontend: InvectFrontendPlugin = {
  id: 'user-auth',
  name: 'User Authentication',

  // ─── App Shell (auth gate) ───
  // Wraps the entire Invect layout with AuthProvider + AuthGate.
  // Shows sign-in page when not authenticated.
  appShell: AuthAppShell,

  // ─── Sidebar ───
  sidebar: [
    {
      label: 'Users',
      icon: Users,
      path: '/users',
      position: 'top',
      permission: 'admin:*',
    },
  ],

  // ─── Sidebar Footer (user avatar + sign-out menu) ───
  sidebarFooter: SidebarUserMenu,

  // ─── Routes ───
  routes: [
    {
      path: '/profile',
      component: ProfilePage,
    },
    {
      path: '/users',
      component: UserManagementPage,
    },
  ],
};
