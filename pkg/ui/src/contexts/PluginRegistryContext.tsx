/**
 * PluginRegistryContext — Collects and resolves contributions from frontend plugins.
 *
 * Provides `usePluginRegistry()` to any component in the tree so they
 * can read sidebar items, routes, panel tabs, header actions, and
 * permission checks contributed by plugins.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  FlowlibFrontendPlugin,
  PluginSidebarContribution,
  PluginRouteContribution,
  PluginPanelTabContribution,
  PluginHeaderActionContribution,
  PermissionContext,
} from '../types/plugin.types';

// ─────────────────────────────────────────────────────────────
// Registry Interface
// ─────────────────────────────────────────────────────────────

export interface PluginRegistry {
  /** All sidebar items from plugins, grouped by position */
  sidebarItems: PluginSidebarContribution[];
  /** Component for the sidebar footer (user menu). First plugin to provide wins. */
  SidebarFooter: React.ComponentType<{ collapsed: boolean; basePath: string }> | null;
  /** All routes contributed by plugins */
  routes: PluginRouteContribution[];
  /** Panel tabs grouped by context (e.g. 'flowEditor', 'nodeConfig') */
  panelTabs: Record<string, PluginPanelTabContribution[]>;
  /** Header actions grouped by context (e.g. 'flowHeader', 'flowList') */
  headerActions: Record<string, PluginHeaderActionContribution[]>;
  /** All provider wrappers from plugins (in registration order) */
  providers: React.ComponentType<{ children: ReactNode }>[];
  /**
   * Application shell from the first plugin that provides one.
   * Can conditionally render children (e.g., auth gate).
   */
  AppShell: React.ComponentType<{
    children: ReactNode;
    apiBaseUrl: string;
    basePath: string;
  }> | null;
  /**
   * Permission checker — first plugin to return non-undefined wins.
   * Returns true if no plugin overrides (default: allow everything).
   */
  checkPermission: (permission: string, context?: PermissionContext) => boolean;
  /** Whether any plugins are registered */
  hasPlugins: boolean;
}

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

const defaultRegistry: PluginRegistry = {
  sidebarItems: [],
  SidebarFooter: null,
  routes: [],
  panelTabs: {},
  headerActions: {},
  providers: [],
  AppShell: null,
  checkPermission: () => true,
  hasPlugins: false,
};

const PluginRegistryContext = createContext<PluginRegistry>(defaultRegistry);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

interface PluginRegistryProviderProps {
  plugins: FlowlibFrontendPlugin[];
  children: ReactNode;
}

export function PluginRegistryProvider({ plugins, children }: PluginRegistryProviderProps) {
  const registry = useMemo(() => buildRegistry(plugins), [plugins]);

  // Wrap children in all plugin providers (outermost = first plugin)
  let wrapped = <>{children}</>;
  for (let i = registry.providers.length - 1; i >= 0; i--) {
    const Provider = registry.providers[i];
    wrapped = <Provider>{wrapped}</Provider>;
  }

  return (
    <PluginRegistryContext.Provider value={registry}>{wrapped}</PluginRegistryContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

/**
 * Access the plugin registry from any component inside `<Flowlib />`.
 * Returns a default (empty) registry if no plugins are registered.
 */
export function usePluginRegistry(): PluginRegistry {
  return useContext(PluginRegistryContext);
}

// ─────────────────────────────────────────────────────────────
// Registry Builder
// ─────────────────────────────────────────────────────────────

function buildRegistry(plugins: FlowlibFrontendPlugin[]): PluginRegistry {
  const sidebarItems: PluginSidebarContribution[] = [];
  let SidebarFooter: React.ComponentType<{ collapsed: boolean; basePath: string }> | null = null;
  let AppShell: React.ComponentType<{
    children: ReactNode;
    apiBaseUrl: string;
    basePath: string;
  }> | null = null;
  const routes: PluginRouteContribution[] = [];
  const panelTabs: Record<string, PluginPanelTabContribution[]> = {};
  const headerActions: Record<string, PluginHeaderActionContribution[]> = {};
  const providers: React.ComponentType<{ children: ReactNode }>[] = [];
  const permissionCheckers: Array<
    (permission: string, context?: PermissionContext) => boolean | undefined
  > = [];

  for (const plugin of plugins) {
    // Collect sidebar items
    if (plugin.sidebar) {
      sidebarItems.push(...plugin.sidebar);
    }

    // Collect sidebar footer (first plugin to provide wins)
    if (plugin.sidebarFooter && !SidebarFooter) {
      SidebarFooter = plugin.sidebarFooter;
    }

    // Collect app shell (first plugin to provide wins)
    if (plugin.appShell && !AppShell) {
      AppShell = plugin.appShell;
    }

    // Collect routes
    if (plugin.routes) {
      routes.push(...plugin.routes);
    }

    // Collect panel tabs
    if (plugin.panelTabs) {
      for (const tab of plugin.panelTabs) {
        if (!panelTabs[tab.context]) {
          panelTabs[tab.context] = [];
        }
        panelTabs[tab.context].push(tab);
      }
    }

    // Collect header actions
    if (plugin.headerActions) {
      for (const action of plugin.headerActions) {
        if (!headerActions[action.context]) {
          headerActions[action.context] = [];
        }
        headerActions[action.context].push(action);
      }
    }

    // Collect providers
    if (plugin.providers) {
      providers.push(...plugin.providers);
    }

    // Collect permission checkers
    if (plugin.checkPermission) {
      permissionCheckers.push(plugin.checkPermission);
    }
  }

  // Build composite permission checker
  const checkPermission = (permission: string, context?: PermissionContext): boolean => {
    for (const checker of permissionCheckers) {
      const result = checker(permission, context);
      if (result !== undefined) {
        return result;
      }
    }
    // Default: allow everything when no plugin overrides
    return true;
  };

  return {
    sidebarItems,
    SidebarFooter,
    AppShell,
    routes,
    panelTabs,
    headerActions,
    providers,
    checkPermission,
    hasPlugins: plugins.length > 0,
  };
}
