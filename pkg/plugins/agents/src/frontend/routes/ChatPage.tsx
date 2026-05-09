/**
 * ChatPage — the main chat surface.
 *
 * Layout (per `plans/agents/frontend.md`):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Header: agent name | model picker | visibility | menu      │
 *   ├──────────┬────────────────────────────────────────────────┤
 *   │ session  │  message list (ChatStream)                      │
 *   │ list     │                                                  │
 *   │          │                                                  │
 *   │          ├────────────────────────────────────────────────┤
 *   │          │  InputBar                                        │
 *   └──────────┴────────────────────────────────────────────────┘
 *
 * The session sidebar is rendered as a slim placeholder; Stream L's
 * `AgentDetailPage` already lists sessions for the agent at
 * `/agents/:agentId`, so when navigating from there the user has the
 * full session list one level up. v1's ChatPage just shows "← back"
 * and the current title — we don't duplicate the session list inside
 * the chat surface.
 *
 * Route binding: `/agents/:agentId/sessions/:sessionId`.
 *
 * @see chat-routes.ts for the route contribution.
 */
import * as React from 'react';
import { useParams, Link } from 'react-router';
import { ChatStream, type PendingUserMessage } from '../components/ChatStream';
import { InputBar } from '../components/InputBar';
import { useChatStream, type ChatStreamAdapters } from '../hooks/useChatStream';
import type { AgentProviderId } from '../../shared/types';

export interface ChatPageProps {
  /** Plugin route base path (passed by the host router). */
  basePath: string;
  /**
   * Optional adapter override — primarily used by tests and Storybook.
   * Production usage relies on the default `agents/react` +
   * `@cloudflare/ai-chat/react` adapters.
   */
  adapters?: ChatStreamAdapters;
}

export const ChatPage: React.FC<ChatPageProps> = ({ basePath, adapters }) => {
  const params = useParams<{ agentId: string; sessionId: string }>();
  const agentId = params.agentId ?? '';
  const sessionId = params.sessionId ?? '';

  const {
    events,
    status,
    error,
    session,
    send,
    interrupt,
    permissionResponse,
    hilResponse,
    resolvedPermissions,
    resolvedHumanInputs,
  } = useChatStream(sessionId, adapters);

  const [pendingUser, setPendingUser] = React.useState<PendingUserMessage[]>([]);
  const [model, setModel] = React.useState<string | null>(session?.model ?? null);

  // When the session loads, reflect its model in the picker.
  React.useEffect(() => {
    if (session && session.model && model === null) {
      setModel(session.model);
    }
  }, [session, model]);

  // Once the assistant emits its first text-delta after a pending user
  // submission, drop that pending entry. Easiest heuristic: clear all
  // pending entries on the next streaming event after submission.
  React.useEffect(() => {
    if (events.length > 0 && pendingUser.length > 0) {
      // Find the highest event index — if it's >0 we've started getting
      // server-side events, so the optimistic bubble can roll into the
      // server state.
      setPendingUser((prev) => prev.slice(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  const handleSend = React.useCallback(
    (text: string) => {
      const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPendingUser((prev) => [...prev, { id, text }]);
      send(text).catch((err) => {
        // On send failure, surface but don't clear the pending bubble —
        // the user can retry.
        // eslint-disable-next-line no-console
        console.error('[ChatPage] send failed', err);
      });
    },
    [send],
  );

  const providerId: AgentProviderId | undefined = session
    ? // The session itself doesn't carry the provider; in production the
      // chat header would resolve via the agent definition. v1: leave
      // undefined so the picker shows the union of all defaults.
      undefined
    : undefined;

  return (
    <div className="flex flex-col w-full h-full bg-fl-background text-fl-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-fl-border bg-fl-background/95 backdrop-blur supports-[backdrop-filter]:bg-fl-background/80">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`${basePath}/agents/${agentId}`}
            className="text-xs text-fl-muted-foreground hover:text-fl-foreground"
            aria-label="Back to agent"
          >
            ← Back
          </Link>
          <h1 className="text-sm font-semibold truncate">
            {session?.title ?? 'Loading…'}
          </h1>
          {status === 'error' && error ? (
            <span
              className="text-xs text-fl-destructive"
              role="alert"
            >
              {error}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs text-fl-muted-foreground"
            data-testid="connection-status"
          >
            {humanStatus(status)}
          </span>
        </div>
      </header>

      {/* Message list */}
      <ChatStream
        events={events}
        pendingUser={pendingUser}
        streaming={status === 'streaming'}
        onPermissionRespond={permissionResponse}
        onHilRespond={hilResponse}
        resolvedPermissions={resolvedPermissions}
        resolvedHumanInputs={resolvedHumanInputs}
      />

      {/* Input */}
      <InputBar
        onSend={handleSend}
        onInterrupt={interrupt}
        streaming={status === 'streaming'}
        disabled={status === 'connecting' || status === 'error'}
        model={model}
        onModelChange={setModel}
        providerId={providerId}
      />
    </div>
  );
};

ChatPage.displayName = 'ChatPage';

function humanStatus(status: 'connecting' | 'streaming' | 'idle' | 'error'): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'streaming':
      return 'Streaming…';
    case 'idle':
      return 'Ready';
    case 'error':
      return 'Error';
  }
}

export default ChatPage;
