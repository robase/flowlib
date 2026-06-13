/**
 * AgentsLayout — the unified `/agents[/sessions/:sessionId]` workspace.
 *
 * Three columns plus a slide-out inspector:
 *
 *   ┌────────────┬───────────────────────┬───────────┐
 *   │ sessions   │ chat                  │ inspector │  ◀ icon rail
 *   │ (flat list)│ (sticky header +      │ (slides   │    fixed
 *   │            │  thread + composer)   │  in/out)  │    top-right
 *   └────────────┴───────────────────────┴───────────┘
 *
 * The same component handles both routes — the sidebar always renders;
 * the centre pane is either an empty placeholder or
 * `<ChatThread session={...} />` driven by the URL's `sessionId`.
 *
 * Workspaces are hidden from the user. "+ New chat" creates a session
 * with `workspaceId` omitted; the backend auto-provisions a fresh
 * workspace + sandbox. There is no workspace picker or grouping anywhere
 * in the UI — one chat, one (invisible) sandbox.
 *
 * Runtime composition (assistant-ui ThreadList migration):
 *
 *   AgentsLayout
 *     ├─ useRemoteThreadListRuntime — owns the thread list + per-thread runtimes
 *     └─ <AssistantRuntimeProvider runtime={runtime}>
 *         ├─ <SessionsSidebar/>      — flat, searchable chat list
 *         ├─ <ChatThread/>           — reads session resources from ActiveSessionContext
 *         └─ <InspectorPane/>        — Memory / Skills / MCP / Tools / Hooks
 *
 * "+ New chat" creates a session immediately (no credential/model
 * prompt) and navigates to it — the model is chosen later in the chat
 * header.
 */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from '@assistant-ui/react';
import { Bot, Plus } from 'lucide-react';
import { ChatThread } from '../components/ChatThread';
import { SessionsSidebar } from '../components/SessionsSidebar';
import { InspectorRail } from '../components/InspectorRail';
import { InspectorPane, type TabId } from '../components/inspector/InspectorPane';
import { useAgentRuntime } from '../hooks/useAgentRuntime';
import { useAgentsThreadListAdapter } from '../hooks/useAgentsThreadListAdapter';
import {
  useCreateSession,
  useProviderCatalogue,
  useSession,
  useSessions,
} from '../hooks/useSessions';
import { useLlmCredentials } from '../hooks/useCredentials';
import { cn } from '../lib/cn';

export interface AgentsLayoutProps {
  basePath: string;
}

export function AgentsLayout({ basePath }: AgentsLayoutProps): React.ReactElement {
  const params = useParams<{ sessionId?: string }>();
  const sessionId = params.sessionId ?? null;

  const navigate = useNavigate();
  const sessions = useSessions();
  const credentials = useLlmCredentials();
  const activeSession = useSession(sessionId);
  const createSession = useCreateSession();
  const { catalogue, defaultProviderId } = useProviderCatalogue();

  // Auto-pick the first active LLM credential so a new chat is usable
  // immediately without a picker. Falls back to `null` (deployment
  // default) when the org has no credentials.
  const firstActiveCredentialId = React.useMemo(
    () => (credentials.data ?? []).find((c) => c.isActive)?.id ?? null,
    [credentials.data],
  );

  const adapter = useAgentsThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: useAgentRuntime,
    threadId: sessionId ?? undefined,
  });

  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<TabId>('memory');

  const selectTab = React.useCallback(
    (tab: TabId) => {
      // Clicking the active tab while open closes the inspector;
      // otherwise open + switch to it.
      setInspectorOpen((open) => {
        if (open && tab === activeTab) {
          return false;
        }
        return true;
      });
      setActiveTab(tab);
    },
    [activeTab],
  );

  // Create a session immediately — no credential/model prompt. The model
  // can be changed later from the chat header; the credential defaults to
  // the first active one (or deployment default). `workspaceId` is omitted
  // → the backend auto-provisions a fresh (invisible) workspace.
  const createAndOpen = React.useCallback(
    (credentialId: string | null) => {
      if (createSession.isPending) {
        return;
      }
      // Use the deployment's default provider + its first declared model
      // (backend-driven), so the auto-created chat gets a valid model spec
      // for this deployment's credentials (e.g. hosted's `openrouter/*`).
      const provider = catalogue.find((p) => p.id === defaultProviderId) ?? catalogue[0];
      createSession
        .mutateAsync({
          credentialId,
          providerId: provider?.id,
          model: provider?.models[0]?.id,
        })
        .then((session) => {
          navigate(
            `${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(session.id)}`,
          );
        })
        .catch(() => {
          // Surfaced via `createSession.error` in the center pane below.
        });
    },
    [basePath, createSession, navigate, catalogue, defaultProviderId],
  );

  const openNewChat = React.useCallback(() => {
    createAndOpen(firstActiveCredentialId);
  }, [createAndOpen, firstActiveCredentialId]);

  // Land directly in a chat instead of an empty placeholder: when the
  // route has no `sessionId`, open the most recent active session, or
  // create a fresh one if there are none. `autoCreatedRef` guards against
  // spawning more than one chat while the list refetches; we never
  // auto-retry after a failure (the error is shown instead).
  const autoCreatedRef = React.useRef(false);
  React.useEffect(() => {
    if (sessionId || sessions.isLoading) {
      return;
    }
    const active = (sessions.data ?? []).filter((s) => s.status === 'active');
    if (active.length > 0) {
      const mostRecent = [...active].sort((a, b) => sessionActivityMs(b) - sessionActivityMs(a))[0];
      navigate(
        `${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(mostRecent.id)}`,
        { replace: true },
      );
      return;
    }
    // No sessions yet — wait for the credential list so we can attach one,
    // then create exactly one chat.
    if (credentials.isLoading) {
      return;
    }
    if (!autoCreatedRef.current && !createSession.isPending && !createSession.isError) {
      autoCreatedRef.current = true;
      createAndOpen(firstActiveCredentialId);
    }
  }, [
    sessionId,
    sessions.isLoading,
    sessions.data,
    credentials.isLoading,
    createSession.isPending,
    createSession.isError,
    firstActiveCredentialId,
    createAndOpen,
    navigate,
    basePath,
  ]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        className="relative flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
        data-testid="agents-layout"
      >
        {/* Inspector rail — pinned to the top-right of the workspace */}
        <div className="absolute right-4 top-4 z-50">
          <InspectorRail open={inspectorOpen} activeTab={activeTab} onSelect={selectTab} />
        </div>

        {/* LEFT — sessions */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <SessionsSidebar
            basePath={basePath}
            sessions={sessions.data ?? []}
            isLoading={sessions.isLoading}
            activeSessionId={sessionId}
            onNewChat={openNewChat}
          />
        </aside>

        {/* CENTER — chat */}
        <main className="flex min-w-0 flex-1 flex-col" data-testid="agents-main">
          {sessionId ? (
            activeSession.data ? (
              <ChatThread session={activeSession.data} />
            ) : activeSession.isLoading ? (
              <CenteredMessage>Loading chat…</CenteredMessage>
            ) : activeSession.error ? (
              <CenteredMessage>
                <span className="text-destructive">{(activeSession.error as Error).message}</span>
              </CenteredMessage>
            ) : (
              <CenteredMessage>Chat not found.</CenteredMessage>
            )
          ) : createSession.isError ? (
            <ChatStartError
              message={(createSession.error as Error).message}
              onRetry={() => createAndOpen(firstActiveCredentialId)}
            />
          ) : sessions.isError ? (
            <CenteredMessage>
              <span className="text-destructive">{(sessions.error as Error).message}</span>
            </CenteredMessage>
          ) : sessions.isLoading || credentials.isLoading || createSession.isPending ? (
            <CenteredMessage>Starting chat…</CenteredMessage>
          ) : (
            // Fallback CTA — the auto-open effect normally redirects or
            // creates a chat before this renders.
            <NoChatSelected onNewChat={openNewChat} />
          )}
        </main>

        {/* RIGHT — inspector, animates width + slide */}
        <aside
          aria-hidden={!inspectorOpen}
          className={cn(
            'shrink-0 overflow-hidden border-border transition-[width] duration-300 ease-in-out',
            inspectorOpen ? 'w-96 border-l' : 'w-0 border-l-0',
          )}
        >
          <div
            className={cn(
              'h-full w-96 transition-transform duration-300 ease-in-out',
              inspectorOpen ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            <InspectorPane tab={activeTab} session={activeSession.data ?? null} />
          </div>
        </aside>
      </div>
    </AssistantRuntimeProvider>
  );
}

function NoChatSelected({ onNewChat }: { onNewChat: () => void }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-sm text-center">
        <Bot className="mx-auto size-10 text-muted-foreground/40" />
        <h2 className="mt-4 text-base font-semibold">No chat selected</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a chat from the sidebar, or start a new one.
        </p>
        <button
          type="button"
          onClick={onNewChat}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          data-testid="agents-empty-new-chat"
        >
          <Plus className="size-4" />
          New chat
        </button>
      </div>
    </div>
  );
}

function ChatStartError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Bot className="mx-auto size-10 text-muted-foreground/40" />
        <h2 className="mt-4 text-base font-semibold">Couldn’t start a chat</h2>
        <p className="mt-1 text-sm text-destructive break-words">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          data-testid="agents-start-error-retry"
        >
          <Plus className="size-4" />
          Try again
        </button>
      </div>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Recency key for a session — mirrors the sidebar's sort order. */
function sessionActivityMs(session: { lastMessageAt: string | null; updatedAt: string }): number {
  return new Date(session.lastMessageAt ?? session.updatedAt).getTime();
}

export default AgentsLayout;
