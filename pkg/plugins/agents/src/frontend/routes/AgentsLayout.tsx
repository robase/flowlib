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
 *     ├─ <AssistantRuntimeProvider runtime={runtime}>
 *     │   ├─ <SessionsSidebar/>      — flat, searchable chat list
 *     │   ├─ <ChatThread/>           — reads session resources from ActiveSessionContext
 *     │   └─ <InspectorPane/>        — Memory / Skills / MCP / Tools / Hooks
 *     └─ <NewChatDialog/>            — credential + model for a new chat
 */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from '@assistant-ui/react';
import { Bot, Plus } from 'lucide-react';
import { ChatThread } from '../components/ChatThread';
import { NewChatDialog } from '../components/NewChatDialog';
import { SessionsSidebar } from '../components/SessionsSidebar';
import { InspectorRail } from '../components/InspectorRail';
import { InspectorPane, type TabId } from '../components/inspector/InspectorPane';
import { useAgentRuntime } from '../hooks/useAgentRuntime';
import { useAgentsThreadListAdapter } from '../hooks/useAgentsThreadListAdapter';
import { useLlmCredentials } from '../hooks/useCredentials';
import { useCreateSession, useSession, useSessions } from '../hooks/useSessions';
import { cn } from '../lib/cn';
import type { AgentProviderId } from '../../shared/types';

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

  const adapter = useAgentsThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: useAgentRuntime,
    threadId: sessionId ?? undefined,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
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

  const openNewChat = React.useCallback(() => {
    setDialogOpen(true);
  }, []);

  const closeDialog = React.useCallback(() => {
    if (createSession.isPending) {
      return;
    }
    setDialogOpen(false);
  }, [createSession.isPending]);

  const handleStart = React.useCallback(
    async ({
      credentialId,
      providerId,
      model,
    }: {
      credentialId: string | null;
      providerId?: AgentProviderId;
      model?: string;
    }) => {
      // `workspaceId` omitted → backend auto-provisions a fresh
      // workspace + sandbox. The user never sees it.
      const session = await createSession.mutateAsync({ credentialId, providerId, model });
      setDialogOpen(false);
      navigate(`${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(session.id)}`);
    },
    [basePath, createSession, navigate],
  );

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
          ) : (
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

        <NewChatDialog
          open={dialogOpen}
          credentials={credentials.data ?? []}
          isLoading={credentials.isLoading}
          error={(credentials.error as Error | null) ?? null}
          isStarting={createSession.isPending}
          onCancel={closeDialog}
          onStart={handleStart}
        />
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

export default AgentsLayout;
