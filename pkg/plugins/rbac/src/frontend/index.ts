/**
 * @flowlib/rbac/ui — Frontend Plugin Entry Point
 *
 * This is the browser-safe entry point that exports the RBAC frontend plugin.
 * Import via: `import { rbacFrontend } from '@flowlib/rbac/ui'`
 *
 * No Node.js dependencies. No @flowlib/core runtime imports.
 */

import { Shield } from 'lucide-react';
import { RbacProvider, useRbac } from './providers/RbacProvider';
import { ShareButton } from './components/ShareButton';
import { FlowAccessPanel } from './components/FlowAccessPanel';
import { AccessControlPage } from './components/AccessControlPage';
import type { FlowlibFrontendPlugin } from './types';

// ─────────────────────────────────────────────────────────────
// RBAC Frontend Plugin Definition
// ─────────────────────────────────────────────────────────────

export const rbacFrontend: FlowlibFrontendPlugin = {
  id: 'rbac',
  name: 'Role-Based Access Control',

  // ─── Providers ───
  // Wraps the app tree with RBAC context (current user, permissions cache)
  providers: [RbacProvider],

  // ─── Sidebar ───
  sidebar: [
    {
      label: 'Access',
      icon: Shield,
      path: '/access',
      position: 'top',
      order: 70,
      permission: 'flow:read',
    },
  ],

  // ─── Routes ───
  routes: [
    {
      path: '/access',
      component: AccessControlPage,
    },
  ],

  // ─── Panel Tabs ───
  panelTabs: [
    {
      context: 'flowEditor',
      label: 'Access',
      icon: Shield,
      component: FlowAccessPanel,
      permission: 'flow:read',
    },
  ],

  // ─── Header Actions ───
  headerActions: [
    {
      context: 'flowHeader',
      component: ShareButton,
      permission: 'flow:read',
    },
  ],

  // ─── Component Implementations ───
  // These resolve backend-declared componentIds to actual React components
  components: {
    'rbac.AccessControlPage': AccessControlPage as unknown as React.ComponentType<
      Record<string, unknown>
    >,
    'rbac.FlowAccessPanel': FlowAccessPanel as unknown as React.ComponentType<
      Record<string, unknown>
    >,
    'rbac.ShareButton': ShareButton as unknown as React.ComponentType<Record<string, unknown>>,
  },

  // ─── Permission Checking ───
  // Delegates to the RbacProvider's cached permissions.
  // This is called by the host app's plugin registry to gate UI elements.
  checkPermission: (_permission: string, _context?) => {
    // We can't call useRbac() here (not in a React component).
    // Return undefined to defer to the registry's default behavior.
    // The actual permission check happens via useRbac().checkPermission()
    // inside each component that needs it.
    return undefined;
  },
};

// ─────────────────────────────────────────────────────────────
// Re-exports for direct use
// ─────────────────────────────────────────────────────────────

// Provider & hook
export { RbacProvider, useRbac };

// Components (for custom layouts)
export { ShareButton } from './components/ShareButton';
export { ShareFlowModal } from './components/ShareFlowModal';
export { FlowAccessPanel } from './components/FlowAccessPanel';
export { AccessControlPage } from './components/AccessControlPage';
export { TeamsPage } from './components/TeamsPage';
export { UserMenuSection, UserAvatar } from './components/UserMenuSection';

// Hooks
export {
  useAccessibleFlows,
  useFlowAccess,
  useGrantFlowAccess,
  useRevokeFlowAccess,
} from './hooks/useFlowAccess';

export {
  useTeams,
  useTeam,
  useMyTeams,
  useUpdateTeam,
  useCreateTeam,
  useDeleteTeam,
  useAddTeamMember,
  useRemoveTeamMember,
} from './hooks/useTeams';

export {
  useScopeTree,
  useScopeAccess,
  useGrantScopeAccess,
  useRevokeScopeAccess,
  useEffectiveFlowAccess,
  useMoveFlow,
  usePreviewMove,
} from './hooks/useScopes';

// Types
export type {
  FlowlibFrontendPlugin,
  PluginSidebarContribution,
  PluginRouteContribution,
  PluginPanelTabContribution,
  PluginHeaderActionContribution,
  PanelTabProps,
  HeaderActionProps,
  PermissionContext,
} from './types';
