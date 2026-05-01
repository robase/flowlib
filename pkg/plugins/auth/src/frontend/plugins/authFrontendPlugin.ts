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
import { SignInPage } from '../components/SignInPage';
import { SignUpPage } from '../components/SignUpPage';
import { ForgotPasswordPage } from '../components/ForgotPasswordPage';
import { ResetPasswordPage } from '../components/ResetPasswordPage';
import type { FlowlibFrontendPlugin } from '@flowlib/ui';

export const authFrontend: FlowlibFrontendPlugin = {
  id: 'user-auth',
  name: 'User Authentication',

  // ─── App Shell (auth gate) ───
  // Wraps the entire Flowlib layout with AuthProvider + AuthGate.
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
  // The /sign-in, /sign-up, /forgot-password, /reset-password pages are
  // primarily rendered by AuthAppShell when unauthenticated. Registering
  // them here as well means authenticated users hitting those URLs directly
  // get redirected home (via the page components' internal guard) instead
  // of falling through to a blank `<Outlet />`.
  routes: [
    { path: '/sign-in', component: SignInPage },
    { path: '/sign-up', component: SignUpPage },
    { path: '/forgot-password', component: ForgotPasswordPage },
    { path: '/reset-password', component: ResetPasswordPage },
    { path: '/profile', component: ProfilePage },
    { path: '/users', component: UserManagementPage },
  ],
};
