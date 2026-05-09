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
import { AgentsApiClient } from './agents.api';
import { SessionsApiClient } from './sessions.api';
import { WorkspacesApiClient } from './workspaces.api';

export interface AgentsApiClients {
  agents: AgentsApiClient;
  sessions: SessionsApiClient;
  workspaces: WorkspacesApiClient;
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
  const clients = React.useMemo<AgentsApiClients>(() => {
    if (value) return value;
    return {
      agents: new AgentsApiClient({ baseUrl }),
      sessions: new SessionsApiClient({ baseUrl }),
      workspaces: new WorkspacesApiClient({ baseUrl }),
    };
  }, [value, baseUrl]);

  return (
    <AgentsApiContext.Provider value={clients}>{children}</AgentsApiContext.Provider>
  );
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
