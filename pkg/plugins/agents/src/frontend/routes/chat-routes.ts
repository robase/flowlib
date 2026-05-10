/**
 * Chat-route contribution for the Stream M chat surface.
 *
 * Stream L's `agentsFrontendPlugin` deliberately omits the chat routes
 * (see header in `frontend/plugins/agentsFrontendPlugin.ts`). The
 * stream split is explicit about Stream M shipping its own composable
 * plugin object so the two streams stay merge-clean.
 *
 * **Wiring (one-time follow-up needed after both streams land):**
 *
 * The package's `browser.ts` (Stream L's territory) re-exports
 * `agentsFrontendPlugin` from the browser bundle entry. To make
 * `agentsChatFrontendPlugin` discoverable through the same import,
 * Stream L should add the matching re-export:
 *
 * ```ts
 * // pkg/plugins/agents/src/browser.ts
 * export { agentsChatFrontendPlugin, agentsChatRoutes }
 *   from './frontend/routes/chat-routes';
 * ```
 *
 * Once that lands, hosts compose the two like this:
 *
 * ```ts
 * import { agentsFrontendPlugin, agentsChatFrontendPlugin }
 *   from '@flowlib/agents';
 *
 * <Flowlib config={{
 *   plugins: [agentsFrontendPlugin, agentsChatFrontendPlugin],
 * }} />
 * ```
 *
 * Until then the chat surface is reachable via the deep import
 * `@flowlib/agents/src/frontend/routes/chat-routes` (development only)
 * or by Stream L folding `agentsChatRoutes` directly into
 * `agentsFrontendPlugin.routes` and republishing.
 */
import type { ComponentType, ReactNode } from 'react';
import { ChatPage } from './ChatPage';

export interface ChatRouteContribution {
  path: string;
  component: ComponentType<{ basePath: string }>;
  flowScoped?: boolean;
}

export const agentsChatRoutes: ChatRouteContribution[] = [
  {
    path: '/agents/sessions/:sessionId',
    component: ChatPage,
  },
];

/** Structural mirror of `FlowlibFrontendPlugin` — see Stream L's file. */
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
  routes?: Array<ChatRouteContribution>;
};

/**
 * Composable frontend plugin contributing the chat surface route.
 * Designed to coexist with `agentsFrontendPlugin` from Stream L.
 *
 * The plugin id intentionally namespaces under `agents.chat` so the
 * host treats it as a sibling of `agents` rather than a replacement.
 */
export const agentsChatFrontendPlugin: FlowlibFrontendPluginShape = {
  id: 'agents.chat',
  name: 'Agents — Chat',
  routes: agentsChatRoutes,
};

export default agentsChatFrontendPlugin;
