import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Route,
  Routes,
  Outlet,
  BrowserRouter,
  MemoryRouter,
  useInRouterContext,
} from 'react-router';
import { ValidationProvider } from './contexts/ValidationContext';
import { ApiProvider } from './contexts/ApiContext';
import { ThemeProvider, useOptionalTheme } from './contexts/ThemeProvider';
import { NodeRegistryProvider } from './contexts/NodeRegistryContext';
import { PluginRegistryProvider, usePluginRegistry } from './contexts/PluginRegistryContext';
import { FrontendPathProvider, buildFrontendRoute } from './contexts/FrontendPathContext';
import type { InvectFrontendPlugin, InvectPluginDefinition } from './types/plugin.types';
import { resolvePlugins } from './types/plugin.types';
import { Home } from './routes/home';
import { AllFlowRuns } from './routes/all-flow-runs';
import { Flow } from './routes/flow';
import { FlowRuns } from './routes/flow-runs';
import { Credentials } from './routes/credentials';
import { FlowRouteLayout } from './routes/flow-route-layout';
import type { ApiClient } from './api/client';
import { OAuth2CallbackHandler } from './components/credentials/OAuth2ConnectButton';
import './app.css';
import { AppSideMenu } from './components/side-menu/side-menu';

// ─────────────────────────────────────────────────────────────
// Config type (frontend-relevant subset of InvectConfig)
// ─────────────────────────────────────────────────────────────

/**
 * Invect configuration object. Pass the same `defineConfig({...})` object
 * used on the backend — the frontend reads only the fields it needs.
 *
 * When using the `browser` export condition on plugin packages, imports like
 * `import { auth } from '@flowlib/user-auth'` resolve to a lightweight
 * frontend-only entry, so no server code is bundled.
 */
export interface InvectConfig {
  /** Base URL for the Invect API (e.g. `/api/flowlib`). @default 'http://localhost:3000/flowlib' */
  apiPath?: string;
  /** Base path where the Invect UI is mounted in the browser. @default '/flowlib' */
  frontendPath?: string;
  /** UI theme mode. @default 'dark' */
  theme?: 'light' | 'dark' | 'system';
  /** Plugins (unified definitions with `.backend` and `.frontend`). */
  plugins?: InvectPluginDefinition[];
  /** Allow any backend-specific fields to pass through without error. */
  [key: string]: unknown;
}

export interface InvectProps {
  /**
   * Invect configuration. The same object from `defineConfig()` can be used
   * for both the backend (`createInvectRouter(config)`) and the frontend
   * (`<Invect config={config} />`).
   *
   * @example
   * ```tsx
   * import config from '../flowlib.config';
   * <Invect config={config} />
   * ```
   */
  config: InvectConfig;
  /** Optional React Query client to share with the host app. */
  reactQueryClient?: QueryClient;
  /** Use MemoryRouter instead of BrowserRouter (useful for testing). */
  useMemoryRouter?: boolean;
  /** Pre-configured API client instance (e.g. for demo mode). Overrides config.apiPath. */
  apiClient?: ApiClient;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

const createDefaultQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000, retry: 3 },
    },
  });

function useHasRouterContext(): boolean {
  try {
    return useInRouterContext();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// InvectAppContent — the actual app layout (sidebar + outlet)
// Rendered inside all providers and the optional plugin appShell.
// ─────────────────────────────────────────────────────────────

const InvectAppContent = React.memo(({ basePath }: { basePath?: string }) => (
  <ValidationProvider>
    <NodeRegistryProvider>
      <div className="imp-shell flex w-full h-screen font-sans antialiased bg-imp-background text-imp-foreground">
        <AppSideMenu basePath={basePath} />
        <div className="imp-page flex flex-1 h-full min-w-0 min-h-0 bg-imp-background">
          <Outlet />
        </div>
      </div>
    </NodeRegistryProvider>
  </ValidationProvider>
));
InvectAppContent.displayName = 'InvectAppContent';

// ─────────────────────────────────────────────────────────────
// InvectShelled — wraps content with the plugin appShell if present
// Must be rendered inside PluginRegistryProvider to access the registry.
// ─────────────────────────────────────────────────────────────

const InvectShelled = React.memo(
  ({
    apiBaseUrl,
    basePath,
    children,
  }: {
    apiBaseUrl: string;
    basePath: string;
    children: React.ReactNode;
  }) => {
    const { AppShell } = usePluginRegistry();

    if (AppShell) {
      return (
        <AppShell apiBaseUrl={apiBaseUrl} basePath={basePath}>
          {children}
        </AppShell>
      );
    }
    return <>{children}</>;
  },
);
InvectShelled.displayName = 'InvectShelled';

// ─────────────────────────────────────────────────────────────
// InvectLayout — providers + shell + content
// ─────────────────────────────────────────────────────────────

const InvectLayout = React.memo(
  ({
    client,
    apiBaseUrl,
    apiClient,
    basePath,
    theme,
    plugins,
  }: {
    client: QueryClient;
    apiBaseUrl: string;
    apiClient?: ApiClient;
    basePath: string;
    theme: 'light' | 'dark' | 'system';
    plugins: InvectFrontendPlugin[];
  }) => {
    const themeContext = useOptionalTheme();

    const content = (
      <QueryClientProvider client={client}>
        <ApiProvider baseURL={apiBaseUrl} apiClient={apiClient}>
          <FrontendPathProvider basePath={basePath}>
            <PluginRegistryProvider plugins={plugins}>
              <InvectShelled apiBaseUrl={apiBaseUrl} basePath={basePath}>
                <InvectAppContent basePath={basePath} />
              </InvectShelled>
            </PluginRegistryProvider>
          </FrontendPathProvider>
        </ApiProvider>
      </QueryClientProvider>
    );

    // If already inside a ThemeProvider, skip wrapping another one
    if (themeContext) {
      return content;
    }

    return (
      <ThemeProvider defaultTheme={theme} storageKey="flowlib-ui-theme">
        {content}
      </ThemeProvider>
    );
  },
);
InvectLayout.displayName = 'InvectLayout';

// ─────────────────────────────────────────────────────────────
// InvectRoutes — router tree
// ─────────────────────────────────────────────────────────────

const InvectRoutes = React.memo(
  ({
    client,
    apiBaseUrl,
    apiClient,
    basePath,
    theme,
    plugins,
  }: {
    client: QueryClient;
    apiBaseUrl: string;
    apiClient?: ApiClient;
    basePath: string;
    theme: 'light' | 'dark' | 'system';
    plugins: InvectFrontendPlugin[];
  }) => {
    const pluginRoutes = plugins.flatMap((p) => p.routes ?? []);
    const topLevelPluginRoutes = pluginRoutes.filter((r) => !r.flowScoped);
    const flowScopedPluginRoutes = pluginRoutes.filter((r) => r.flowScoped);

    return (
      <div className="flex-1 w-full h-full min-h-0">
        <Routes>
          <Route
            path={buildFrontendRoute(basePath, '/oauth/callback')}
            element={<OAuth2CallbackHandler />}
          />
          <Route
            path={basePath}
            element={
              <InvectLayout
                client={client}
                apiBaseUrl={apiBaseUrl}
                apiClient={apiClient}
                basePath={basePath}
                theme={theme}
                plugins={plugins}
              />
            }
          >
            <Route index element={<Home basePath={basePath} />} />
            <Route path="credentials" element={<Credentials basePath={basePath} />} />
            <Route path="flow-runs" element={<AllFlowRuns basePath={basePath} />} />
            <Route path="flow/:flowId" element={<FlowRouteLayout basePath={basePath} />}>
              <Route index element={<Flow basePath={basePath} />} />
              <Route path="version/:version" element={<Flow basePath={basePath} />} />
              <Route path="runs" element={<FlowRuns basePath={basePath} />} />
              <Route path="runs/version/:version" element={<FlowRuns basePath={basePath} />} />
              {flowScopedPluginRoutes.map((route) => (
                <Route
                  key={route.path}
                  path={route.path.replace(/^\//, '')}
                  element={<route.component basePath={basePath} />}
                />
              ))}
            </Route>
            {topLevelPluginRoutes.map((route) => (
              <Route
                key={route.path}
                path={route.path.replace(/^\//, '')}
                element={<route.component basePath={basePath} />}
              />
            ))}
          </Route>
        </Routes>
      </div>
    );
  },
);
InvectRoutes.displayName = 'InvectRoutes';

// ─────────────────────────────────────────────────────────────
// Invect — public entry point
// ─────────────────────────────────────────────────────────────

/**
 * The Invect UI component.
 *
 * Pass the same config object used on the backend — the component reads
 * `apiPath`, `frontendPath`, `theme`, and `plugins`, ignoring backend fields.
 *
 * When the auth plugin is included in `config.plugins`, the app is
 * automatically wrapped with an auth gate (sign-in page when unauthenticated).
 *
 * @example
 * ```tsx
 * import { Invect } from '@flowlib/ui';
 * import config from '../flowlib.config';
 * import '@flowlib/ui/styles';
 *
 * export default function App() {
 *   return <Invect config={config} />;
 * }
 * ```
 */
export const Invect = React.memo(
  ({ config, reactQueryClient, useMemoryRouter = false, apiClient }: InvectProps) => {
    const apiBaseUrl = (config.apiPath as string | undefined) ?? 'http://localhost:3000/flowlib';
    const basePath = (config.frontendPath as string | undefined) ?? '/flowlib';
    const theme = (config.theme as 'light' | 'dark' | 'system' | undefined) ?? 'dark';

    const resolvedPlugins = React.useMemo(
      () => (config.plugins ? resolvePlugins(config.plugins) : []),
      [config.plugins],
    );

    const client = reactQueryClient || createDefaultQueryClient();
    const hasRouter = useHasRouterContext();

    const routes = (
      <InvectRoutes
        client={client}
        apiBaseUrl={apiBaseUrl}
        apiClient={apiClient}
        basePath={basePath}
        theme={theme}
        plugins={resolvedPlugins}
      />
    );

    if (hasRouter) {
      return routes;
    }

    if (useMemoryRouter) {
      return <MemoryRouter initialEntries={[basePath]}>{routes}</MemoryRouter>;
    }

    return <BrowserRouter>{routes}</BrowserRouter>;
  },
);
Invect.displayName = 'Invect';
