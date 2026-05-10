/**
 * ChatPage — the main chat surface.
 *
 * Route: `/agents/sessions/:sessionId`. The session row carries every
 * piece of config needed (provider, model, MCPs, tools, system prompt)
 * so there is no agent-definition lookup.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Header: title | settings toggle | back                       │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Settings drawer (collapsible) — model, system prompt, MCPs   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ message list (ChatStream)                                    │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ InputBar                                                     │
 *   └──────────────────────────────────────────────────────────────┘
 */
import * as React from 'react';
import { useParams, Link } from 'react-router';
import { ChatStream, type PendingUserMessage } from '../components/ChatStream';
import { InputBar } from '../components/InputBar';
import { useChatStream, type ChatStreamAdapters } from '../hooks/useChatStream';
import { useSession, useUpdateSession } from '../hooks/useSessions';
import { useMcpServers } from '../hooks/useMcpServers';
import type { AgentSession } from '../../shared/types';

export interface ChatPageProps {
  basePath: string;
  adapters?: ChatStreamAdapters;
}

export const ChatPage: React.FC<ChatPageProps> = ({ basePath, adapters }) => {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId ?? '';

  const sessionQuery = useSession(sessionId);
  const session = sessionQuery.data;

  const {
    events,
    status,
    error,
    send,
    interrupt,
    permissionResponse,
    hilResponse,
    resolvedPermissions,
    resolvedHumanInputs,
  } = useChatStream(sessionId, adapters);

  const [pendingUser, setPendingUser] = React.useState<PendingUserMessage[]>([]);
  const [showSettings, setShowSettings] = React.useState(false);

  React.useEffect(() => {
    if (events.length > 0 && pendingUser.length > 0) {
      setPendingUser((prev) => prev.slice(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  const handleSend = React.useCallback(
    (text: string) => {
      const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPendingUser((prev) => [...prev, { id, text }]);
      send(text).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[ChatPage] send failed', err);
      });
    },
    [send],
  );

  return (
    <div className="flex flex-col w-full h-full bg-fl-background text-fl-foreground">
      <header className="flex items-center justify-between px-4 py-2 border-b border-fl-border">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`${basePath}/agents`}
            className="text-xs text-fl-muted-foreground hover:text-fl-foreground"
          >
            ← Chats
          </Link>
          <h1 className="text-sm font-semibold truncate">{session?.title ?? 'Loading…'}</h1>
          {session ? (
            <span className="text-xs text-fl-muted-foreground">
              {session.providerId}
              {session.model ? ` · ${session.model}` : ''}
            </span>
          ) : null}
          {status === 'error' && error ? (
            <span className="text-xs text-fl-destructive" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-fl-muted-foreground" data-testid="connection-status">
            {humanStatus(status)}
          </span>
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="text-xs text-fl-muted-foreground hover:text-fl-foreground"
          >
            {showSettings ? 'Hide settings' : 'Settings'}
          </button>
        </div>
      </header>

      {showSettings && session ? <ChatSettings session={session} /> : null}

      <ChatStream
        events={events}
        pendingUser={pendingUser}
        streaming={status === 'streaming'}
        onPermissionRespond={permissionResponse}
        onHilRespond={hilResponse}
        resolvedPermissions={resolvedPermissions}
        resolvedHumanInputs={resolvedHumanInputs}
      />

      <InputBar
        onSend={handleSend}
        onInterrupt={interrupt}
        streaming={status === 'streaming'}
        disabled={status === 'connecting' || status === 'error'}
        model={session?.model ?? null}
        providerId={session?.providerId}
      />
    </div>
  );
};

ChatPage.displayName = 'ChatPage';

/**
 * Inline settings panel — model picker, system prompt textarea, and
 * org-MCP toggles. Each control writes through to `PATCH /sessions/:id`.
 */
function ChatSettings({ session }: { session: AgentSession }): React.ReactElement {
  const update = useUpdateSession();
  const mcpServers = useMcpServers();

  const [model, setModel] = React.useState(session.model ?? '');
  const [systemPrompt, setSystemPrompt] = React.useState(session.systemPrompt ?? '');
  const [enabledMcpIds, setEnabledMcpIds] = React.useState<string[]>(session.enabledMcpServerIds);

  const dirtyModel = model !== (session.model ?? '');
  const dirtySystemPrompt = systemPrompt !== (session.systemPrompt ?? '');
  const dirtyMcps =
    enabledMcpIds.length !== session.enabledMcpServerIds.length ||
    enabledMcpIds.some((id, i) => session.enabledMcpServerIds[i] !== id);
  const dirty = dirtyModel || dirtySystemPrompt || dirtyMcps;

  const handleSave = async () => {
    await update.mutateAsync({
      id: session.id,
      input: {
        model: dirtyModel ? (model.trim() === '' ? null : model.trim()) : undefined,
        systemPrompt: dirtySystemPrompt
          ? systemPrompt.trim() === ''
            ? null
            : systemPrompt
          : undefined,
        enabledMcpServerIds: dirtyMcps ? enabledMcpIds : undefined,
      },
    });
  };

  const toggleMcp = (id: string) => {
    setEnabledMcpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="border-b border-fl-border bg-fl-card/40 px-4 py-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-fl-muted-foreground">Model</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-md border border-fl-border bg-fl-background px-3 py-1.5 text-sm"
          />
        </label>
        <div />
      </div>
      <label className="block">
        <span className="text-xs font-medium text-fl-muted-foreground">System prompt</span>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-fl-border bg-fl-background px-3 py-2 font-mono text-xs"
          placeholder="(none)"
        />
      </label>
      <div>
        <div className="text-xs font-medium text-fl-muted-foreground mb-1">MCP servers</div>
        {mcpServers.isLoading ? (
          <div className="text-xs text-fl-muted-foreground">Loading…</div>
        ) : !mcpServers.data || mcpServers.data.length === 0 ? (
          <div className="text-xs text-fl-muted-foreground">
            No MCP servers configured. Add some on the MCP servers page.
          </div>
        ) : (
          <ul className="space-y-1">
            {mcpServers.data.map((server) => (
              <li key={server.id} className="flex items-center gap-2 text-sm">
                <input
                  id={`mcp-${server.id}`}
                  type="checkbox"
                  checked={enabledMcpIds.includes(server.id)}
                  onChange={() => toggleMcp(server.id)}
                />
                <label htmlFor={`mcp-${server.id}`} className="cursor-pointer">
                  {server.name}{' '}
                  <span className="text-xs text-fl-muted-foreground">({server.transport})</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || update.isPending}
          className="rounded-md bg-fl-primary px-3 py-1 text-xs font-medium text-fl-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

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
