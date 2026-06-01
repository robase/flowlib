/**
 * `@flowlib/agents` — Frontend Plugin Definition
 *
 * Wires the agents plugin's UI into the Flowlib host:
 *  - Sidebar entry "Agents" → `/agents`
 *  - Routes: `/agents`, `/agents/new`, `/agents/:agentId`
 *  - Provider: `AgentsApiProvider` (gives downstream components access
 *    to the three REST clients — agents/sessions/workspaces)
 *
 * **Coordination with Stream M (chat surface):** Stream M owns
 * `/agents/:agentId/sessions/:sessionId` (the chat surface) and the
 * `useChatStream` hook. The cleanest split — given that
 * `FlowlibFrontendPlugin.routes` is a flat list per plugin — is for
 * Stream M to ship its own `agentsChatFrontendPlugin` that the consumer
 * composes alongside this one. This file deliberately leaves chat
 * routes out so the two streams stay merge-clean.
 */

import { MessageSquare } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { AgentsApiProvider } from '../api/context';
import { AgentsLayout } from '../routes/AgentsLayout';
import { McpServersPage } from '../routes/McpServersPage';

/**
 * Structural mirror of `FlowlibFrontendPlugin` from `@flowlib/ui`.
 *
 * Defined locally to avoid taking a runtime dependency (and even a
 * `import type` can't resolve here because `@flowlib/ui` is not in the
 * agents plugin's `package.json` — it is only listed in
 * `tsdown.config.ts`'s `neverBundle` list, which keeps the bundler
 * happy but is invisible to `tsc`). Hosts pass this object straight
 * into `<Flowlib config={{ plugins }}>`, where it gets typed against
 * `FlowlibFrontendPlugin` at the call site.
 */
type FlowlibFrontendPluginShape = {
  id: string;
  name?: string;
  sidebar?: Array<{
    label: string;
    icon: ComponentType<{ className?: string }>;
    path: string;
    badge?: string | (() => string | undefined);
    position?: 'top' | 'bottom';
    permission?: string;
  }>;
  providers?: Array<ComponentType<{ children: ReactNode }>>;
  routes?: Array<{
    path: string;
    component: ComponentType<{ basePath: string }>;
    flowScoped?: boolean;
  }>;
};

export const agentsFrontendPlugin: FlowlibFrontendPluginShape = {
  id: 'agents',
  name: 'Agents',

  sidebar: [
    {
      label: 'Chats',
      icon: MessageSquare,
      path: '/agents',
      position: 'top',
    },
  ],

  // Wrap the entire React tree in `AgentsApiProvider` so any descendant
  // route can call `useAgentsApiClients()`. Defaults to relative
  // (same-origin) URLs — consumer hosts that mount Flowlib at the same
  // origin as their backend get this for free.
  providers: [AgentsApiProvider],

  routes: [
    { path: '/agents', component: AgentsLayout },
    { path: '/agents/mcp-servers', component: McpServersPage },
  ],
};

export default agentsFrontendPlugin;
