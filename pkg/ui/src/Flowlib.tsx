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
import type { FlowlibFrontendPlugin, FlowlibPluginDefinition } from './types/plugin.types';
import { resolvePlugins } from './types/plugin.types';
import { Home } from './routes/home';
import { AllFlowRuns } from './routes/all-flow-runs';
import { Flow } from './routes/flow';
import { Credentials } from './routes/credentials';
import { Settings } from './routes/settings';
import { FlowRouteLayout } from './routes/flow-route-layout';
import type { ApiClient } from './api/client';
import { OAuth2CallbackHandler } from './components/credentials/OAuth2ConnectButton';
import './app.css';
import { AppSideMenu } from './components/side-menu/side-menu';

// ─────────────────────────────────────────────────────────────
// Config type (frontend-relevant subset of FlowlibConfig)
// ─────────────────────────────────────────────────────────────

/**
 * Flowlib configuration object. Pass the same `defineConfig({...})` object
 * used on the backend — the frontend reads only the fields it needs.
 *
 * When using the `browser` export condition on plugin packages, imports like
 * `import { auth } from '@flowlib/user-auth'` resolve to a lightweight
 * frontend-only entry, so no server code is bundled.
 */
export interface FlowlibConfig {
  /** Base URL for the Flowlib API (e.g. `/api/flowlib`). @default 'http://localhost:3000/flowlib' */
  apiPath?: string;
  /** Base path where the Flowlib UI is mounted in the browser. @default '/flowlib' */
  frontendPath?: string;
  /** UI theme mode. @default 'dark' */
  theme?: 'light' | 'dark' | 'system';
  /** Plugins (unified definitions with `.backend` and `.frontend`). */
  plugins?: FlowlibPluginDefinition[];
  /** Allow any backend-specific fields to pass through without error. */
  [key: string]: unknown;
}

export interface FlowlibProps {
  /**
   * Flowlib configuration. The same object from `defineConfig()` can be used
   * for both the backend (`createFlowlibRouter(config)`) and the frontend
   * (`<Flowlib config={config} />`).
   *
   * @example
   * ```tsx
   * import config from '../flowlib.config';
   * <Flowlib config={config} />
   * ```
   */
  config: FlowlibConfig;
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
// FlowlibAppContent — the actual app layout (sidebar + outlet)
// Rendered inside all providers and the optional plugin appShell.
// ─────────────────────────────────────────────────────────────

const FlowlibAppContent = React.memo(({ basePath }: { basePath?: string }) => (
  <ValidationProvider>
    <NodeRegistryProvider>
      <div className="fl-shell flex w-full h-screen font-sans antialiased bg-fl-background text-fl-foreground">
        <AppSideMenu basePath={basePath} />
        <div className="fl-page flex flex-1 h-full min-w-0 min-h-0 bg-fl-background">
          <Outlet />
        </div>
      </div>
    </NodeRegistryProvider>
  </ValidationProvider>
));
FlowlibAppContent.displayName = 'FlowlibAppContent';

// ─────────────────────────────────────────────────────────────
// FlowlibShelled — wraps content with the plugin appShell if present
// Must be rendered inside PluginRegistryProvider to access the registry.
// ─────────────────────────────────────────────────────────────

const FlowlibShelled = React.memo(
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
FlowlibShelled.displayName = 'FlowlibShelled';

// ─────────────────────────────────────────────────────────────
// FlowlibLayout — providers + shell + content
// ─────────────────────────────────────────────────────────────

const FlowlibLayout = React.memo(
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
    plugins: FlowlibFrontendPlugin[];
  }) => {
    const themeContext = useOptionalTheme();

    const content = (
      <QueryClientProvider client={client}>
        <ApiProvider baseURL={apiBaseUrl} apiClient={apiClient}>
          <FrontendPathProvider basePath={basePath}>
            <PluginRegistryProvider plugins={plugins}>
              <FlowlibShelled apiBaseUrl={apiBaseUrl} basePath={basePath}>
                <FlowlibAppContent basePath={basePath} />
              </FlowlibShelled>
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
FlowlibLayout.displayName = 'FlowlibLayout';

// ─────────────────────────────────────────────────────────────
// FlowlibRoutes — router tree
// ─────────────────────────────────────────────────────────────

const FlowlibRoutes = React.memo(
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
    plugins: FlowlibFrontendPlugin[];
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
              <FlowlibLayout
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
            <Route path="settings" element={<Settings basePath={basePath} />} />
            <Route path="flow-runs" element={<AllFlowRuns basePath={basePath} />} />
            <Route path="flow/:flowId" element={<FlowRouteLayout basePath={basePath} />}>
              <Route index element={<Flow basePath={basePath} />} />
              <Route path="version/:version" element={<Flow basePath={basePath} />} />
              {/* Inspect mode is just the editor on the /runs path — the
                  FlowEditor component branches on pathname to render the
                  read-only canvas + expanded logs. Same component, same
                  sidebar, no Edit/Runs tab. */}
              <Route path="runs" element={<Flow basePath={basePath} />} />
              <Route path="runs/version/:version" element={<Flow basePath={basePath} />} />
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
FlowlibRoutes.displayName = 'FlowlibRoutes';

// ─────────────────────────────────────────────────────────────
// Flowlib — public entry point
// ─────────────────────────────────────────────────────────────

/**
 * The Flowlib UI component.
 *
 * Pass the same config object used on the backend — the component reads
 * `apiPath`, `frontendPath`, `theme`, and `plugins`, ignoring backend fields.
 *
 * When the auth plugin is included in `config.plugins`, the app is
 * automatically wrapped with an auth gate (sign-in page when unauthenticated).
 *
 * @example
 * ```tsx
 * import { Flowlib } from '@flowlib/ui';
 * import config from '../flowlib.config';
 * import '@flowlib/ui/styles';
 *
 * export default function App() {
 *   return <Flowlib config={config} />;
 * }
 * ```
 */
export const Flowlib = React.memo(
  ({ config, reactQueryClient, useMemoryRouter = false, apiClient }: FlowlibProps) => {
    // Normalize both apiPath and frontendPath so downstream code can safely
    // do `${base}${'/foo'}` without producing `//foo` (which the browser
    // parses as a protocol-relative URL → `https://foo/`).
    //
    // For apiPath we strip a trailing slash if present. For frontendPath
    // we additionally collapse `'/'` → `''` so a root-mounted host doesn't
    // emit `'//foo'` from `${basePath}/foo`.
    const rawApiBaseUrl = (config.apiPath as string | undefined) ?? 'http://localhost:3000/flowlib';
    const apiBaseUrl = rawApiBaseUrl.replace(/\/$/, '') || '/';
    const rawBasePath = (config.frontendPath as string | undefined) ?? '/flowlib';
    const basePath =
      rawBasePath === '/' || rawBasePath === '' ? '' : rawBasePath.replace(/\/$/, '');
    const theme = (config.theme as 'light' | 'dark' | 'system' | undefined) ?? 'dark';

    const resolvedPlugins = React.useMemo(
      () => (config.plugins ? resolvePlugins(config.plugins) : []),
      [config.plugins],
    );

    const client = reactQueryClient || createDefaultQueryClient();
    const hasRouter = useHasRouterContext();

    const routes = (
      <FlowlibRoutes
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
Flowlib.displayName = 'Flowlib';
