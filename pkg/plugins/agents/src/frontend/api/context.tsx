/**
 * AgentsApiContext — shares pre-configured API clients with the agents
 * plugin's React tree.
 *
 * The Flowlib host configures `apiPath` once at the `<Flowlib config>`
 * level, but plugin route components only receive `basePath`. We bridge
 * that gap with a context: the plugin's `providers` contribution wraps
 * the tree with an `AgentsApiProvider` that constructs the three API
 * clients (agents, sessions, workspaces) from a single `baseUrl`.
 *
 * Tests inject a stubbed clients bundle directly via the provider
 * `value` prop, bypassing real `fetch` calls.
 */

import * as React from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — peer dep, resolved by host bundler
// eslint-disable-next-line import/no-unresolved
import { useApiBaseURL } from '@flowlib/ui';
import { McpServersApiClient } from './mcp-servers.api';
import { SessionsApiClient } from './sessions.api';
import { WorkspacesApiClient } from './workspaces.api';
import { CredentialsApiClient } from './credentials.api';
import { SkillsApiClient } from './skills.api';

export interface AgentsApiClients {
  mcpServers: McpServersApiClient;
  sessions: SessionsApiClient;
  workspaces: WorkspacesApiClient;
  credentials: CredentialsApiClient;
  skills: SkillsApiClient;
}

const AgentsApiContext = React.createContext<AgentsApiClients | undefined>(undefined);

export interface AgentsApiProviderProps {
  /**
   * Override the entire client bundle — primarily for tests. When
   * supplied, `baseUrl` is ignored.
   */
  value?: AgentsApiClients;
  /**
   * Base URL for Flowlib's API. Defaults to `''` (same-origin,
   * root-mounted).
   */
  baseUrl?: string;
  children?: React.ReactNode;
}

export function AgentsApiProvider({
  value,
  baseUrl,
  children,
}: AgentsApiProviderProps): React.ReactElement {
  // Fall back to the host's `<Flowlib config={{ apiPath }}>` value when
  // the consumer doesn't pass `baseUrl` explicitly. Plugins are mounted
  // *inside* `<ApiProvider>` so the hook is always available at runtime.
  const hostBaseUrl = (useApiBaseURL as () => string)();
  const resolvedBase = baseUrl ?? hostBaseUrl ?? '';

  const clients = React.useMemo<AgentsApiClients>(() => {
    if (value) {
      return value;
    }
    return {
      mcpServers: new McpServersApiClient({ baseUrl: resolvedBase }),
      sessions: new SessionsApiClient({ baseUrl: resolvedBase }),
      workspaces: new WorkspacesApiClient({ baseUrl: resolvedBase }),
      credentials: new CredentialsApiClient({ baseUrl: resolvedBase }),
      skills: new SkillsApiClient({ baseUrl: resolvedBase }),
    };
  }, [value, resolvedBase]);

  return <AgentsApiContext.Provider value={clients}>{children}</AgentsApiContext.Provider>;
}

/** Throws if used outside an `AgentsApiProvider`. */
export function useAgentsApiClients(): AgentsApiClients {
  const ctx = React.useContext(AgentsApiContext);
  if (!ctx) {
    throw new Error(
      'useAgentsApiClients must be used inside an <AgentsApiProvider>. The agents plugin should add it via its `providers` contribution.',
    );
  }
  return ctx;
}
