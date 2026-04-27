/**
 * Frontend Plugin Types
 *
 * Defines the extension points that frontend plugins can contribute to.
 * These types are consumed by the PluginRegistryContext and the Invect
 * component to render plugin-contributed UI elements.
 */

import type { ComponentType, ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────
// Unified Plugin Definition (mirrors @flowlib/core InvectPluginDefinition)
// ─────────────────────────────────────────────────────────────

/**
 * A unified plugin definition containing both backend and frontend parts.
 * The backend extracts `.backend`, the frontend extracts `.frontend`.
 */
export interface InvectPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

// ─────────────────────────────────────────────────────────────
// Plugin Resolution (internal)
// ─────────────────────────────────────────────────────────────

/**
 * Resolve an array of `InvectPluginDefinition` into `InvectFrontendPlugin[]`.
 * Extracts `.frontend` from each definition, filtering out backend-only plugins.
 */
export function resolvePlugins(plugins: InvectPluginDefinition[]): InvectFrontendPlugin[] {
  return plugins
    .map((p) =>
      p.frontend !== null && p.frontend !== undefined ? (p.frontend as InvectFrontendPlugin) : null,
    )
    .filter((p): p is InvectFrontendPlugin => p !== null);
}

// ─────────────────────────────────────────────────────────────
// Frontend Plugin Interface
// ─────────────────────────────────────────────────────────────

/**
 * A frontend plugin that contributes UI to the Invect application.
 * Plugins are registered via `<Invect plugins={[myPlugin]} />`.
 */
export interface InvectFrontendPlugin {
  /** Unique plugin ID — should match backend plugin ID for manifest resolution */
  id: string;

  /** Display name */
  name?: string;

  /** Add items to the sidebar navigation */
  sidebar?: PluginSidebarContribution[];

  /**
   * Component rendered at the very bottom of the sidebar.
   * Receives `collapsed` and `basePath` props to adapt layout and build links.
   * Typically used for user avatar / profile link.
   * Only the first plugin that provides this wins.
   */
  sidebarFooter?: ComponentType<{ collapsed: boolean; basePath: string }>;

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
   * Application shell that wraps the entire Invect layout.
   *
   * Unlike `providers` (which always render children), an appShell can
   * **conditionally** render children — e.g. showing a sign-in page when
   * the user is not authenticated, then rendering the full Invect app once
   * they sign in.
   *
   * The shell renders inside the CSS scope and QueryClientProvider but
   * outside the sidebar, routes, and other layout elements.
   *
   * Only the **first** plugin to provide an appShell wins.
   *
   * @example
   * ```tsx
   * // Auth plugin provides an appShell that gates the app:
   * appShell: ({ children, apiBaseUrl }) => (
   *   <AuthProvider baseUrl={apiBaseUrl}>
   *     <AuthGate fallback={<SignInPage />}>
   *       {children}
   *     </AuthGate>
   *   </AuthProvider>
   * )
   * ```
   */
  appShell?: ComponentType<{
    children: ReactNode;
    apiBaseUrl: string;
    basePath: string;
  }>;

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
  /** Badge text or function returning badge text */
  badge?: string | (() => string | undefined);
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
