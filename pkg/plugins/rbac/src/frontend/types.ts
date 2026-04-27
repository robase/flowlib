/**
 * @flowlib/rbac/ui — Frontend Plugin Types
 *
 * Types for the frontend plugin system. These are consumed by
 * @flowlib/ui to render plugin-contributed UI.
 */

import type { ComponentType, ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────
// Frontend Plugin Interface
// ─────────────────────────────────────────────────────────────

/**
 * A frontend plugin that contributes UI to the Flowlib application.
 * Plugins are registered via `<Flowlib plugins={[myPlugin]} />`.
 */
export interface FlowlibFrontendPlugin {
  /** Unique plugin ID — should match backend plugin ID for manifest resolution */
  id: string;

  /** Display name */
  name?: string;

  /** Add items to the sidebar navigation */
  sidebar?: PluginSidebarContribution[];

  /** Add top-level routes (pages) */
  routes?: PluginRouteContribution[];

  /** Add tabs to contextual panels (flow editor right panel, etc.) */
  panelTabs?: PluginPanelTabContribution[];

  /** Add action buttons/components to contextual headers */
  headerActions?: PluginHeaderActionContribution[];

  /**
   * Named component implementations — resolved from backend componentIds.
   * Key = componentId (e.g. 'rbac.FlowAccessPanel'), value = React component.
   */
  components?: Record<string, ComponentType<Record<string, unknown>>>;

  /** Wrap the React tree with additional providers (auth context, etc.) */
  providers?: ComponentType<{ children: ReactNode }>[];

  /**
   * Inject headers into every API request.
   * Called before each request. Return headers to merge.
   */
  apiHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  /**
   * Check if the current user has a specific permission.
   * Returns true/false to override, or undefined to defer to default.
   */
  checkPermission?: (permission: string, context?: PermissionContext) => boolean | undefined;
}

// ─────────────────────────────────────────────────────────────
// Contribution Types
// ─────────────────────────────────────────────────────────────

export interface PluginSidebarContribution {
  label: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
  /** Position hint: 'top' (after defaults), 'bottom' (before theme toggle) */
  position?: 'top' | 'bottom';
  /** Required permission — item hidden if check fails */
  permission?: string;
}

export interface PluginRouteContribution {
  path: string;
  component: ComponentType<{ basePath: string }>;
  /** If true, route is nested under the flow layout */
  flowScoped?: boolean;
}

export interface PluginPanelTabContribution {
  /** Where the tab appears */
  context: 'flowEditor' | 'nodeConfig';
  label: string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType<PanelTabProps>;
  /** Required permission — tab hidden if check fails */
  permission?: string;
}

export interface PluginHeaderActionContribution {
  /** Where the action appears */
  context: 'flowHeader' | 'flowList';
  component: ComponentType<HeaderActionProps>;
  /** Required permission — action hidden if check fails */
  permission?: string;
}

export interface PanelTabProps {
  flowId: string;
  basePath: string;
}

export interface HeaderActionProps {
  flowId?: string;
  basePath: string;
}

export interface PermissionContext {
  resourceType?: string;
  resourceId?: string;
  flowId?: string;
}
