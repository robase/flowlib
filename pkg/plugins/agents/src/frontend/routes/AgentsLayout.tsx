/**
 * AgentsLayout — the unified `/agents[/sessions/:sessionId]` surface.
 *
 * Layout: sessions sidebar (left) + chat area (right). The same
 * component handles both routes — sidebar always renders; the right
 * pane is either an empty placeholder or `<ChatThread session={...} />`
 * driven by the URL's `sessionId` param.
 *
 * Runtime composition (since the ThreadList migration):
 *
 *   AgentsLayout
 *     ├─ useRemoteThreadListRuntime — owns the thread list + per-thread runtimes
 *     │   ├─ adapter (REST against /sessions)
 *     │   ├─ runtimeHook = useAgentRuntime (called once per active thread)
 *     │   └─ threadId    = URL sessionId  (drives switching)
 *     ├─ <AssistantRuntimeProvider runtime={runtime}>
 *     │   ├─ <SessionsSidebar/>   — uses ThreadListItemPrimitive per row
 *     │   └─ <ChatThread/>        — reads session resources from ActiveSessionContext
 *     └─ <NewChatDialog/>
 *
 * Workspace cardinality (see `docs/sessions-and-sandboxes.md`):
 *
 *   - "+ New workspace" creates a session with `workspaceId` omitted;
 *     backend auto-provisions a fresh workspace + sandbox.
 *   - "+ New chat" creates a session with `workspaceId: <existing>`;
 *     backend reuses the workspace's sandbox.
 *
 * On `createSession.mutateAsync` success the URL is updated; the
 * `threadId` prop on `useRemoteThreadListRuntime` reacts to that and
 * switches the active thread.
 */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from '@assistant-ui/react';
import { Bot } from 'lucide-react';
import { ChatThread } from '../components/ChatThread';
import { NewChatDialog } from '../components/NewChatDialog';
import { SessionsSidebar } from '../components/SessionsSidebar';
import { useAgentRuntime } from '../hooks/useAgentRuntime';
import { useAgentsThreadListAdapter } from '../hooks/useAgentsThreadListAdapter';
import { useLlmCredentials } from '../hooks/useCredentials';
import { useCreateSession, useSession, useSessions } from '../hooks/useSessions';
import { useWorkspaces } from '../hooks/useWorkspaces';
import type { AgentProviderId } from '../../shared/types';

export interface AgentsLayoutProps {
  basePath: string;
}

type DialogTarget =
  | { kind: 'new-workspace' }
  | { kind: 'existing-workspace'; workspaceId: string; workspaceName: string };

export function AgentsLayout({ basePath }: AgentsLayoutProps): React.ReactElement {
  const params = useParams<{ sessionId?: string }>();
  const sessionId = params.sessionId ?? null;

  const navigate = useNavigate();
  const sessions = useSessions();
  const workspaces = useWorkspaces();
  const credentials = useLlmCredentials();
  const activeSession = useSession(sessionId);
  const createSession = useCreateSession();

  const adapter = useAgentsThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: useAgentRuntime,
    threadId: sessionId ?? undefined,
  });

  const [target, setTarget] = React.useState<DialogTarget | null>(null);

  const openNewWorkspace = React.useCallback(() => {
    setTarget({ kind: 'new-workspace' });
  }, []);

  const openNewChat = React.useCallback(
    (workspaceId: string) => {
      const ws = workspaces.data?.find((w) => w.id === workspaceId);
      setTarget({
        kind: 'existing-workspace',
        workspaceId,
        workspaceName: ws?.name ?? 'Workspace',
      });
    },
    [workspaces.data],
  );

  const closeDialog = React.useCallback(() => {
    if (createSession.isPending) {
      return;
    }
    setTarget(null);
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
      if (!target) {
        return;
      }
      const workspaceId = target.kind === 'existing-workspace' ? target.workspaceId : undefined;
      const session = await createSession.mutateAsync({
        credentialId,
        workspaceId,
        providerId,
        model,
      });
      setTarget(null);
      navigate(`${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(session.id)}`);
    },
    [basePath, createSession, navigate, target],
  );

  const targetLabel =
    target?.kind === 'existing-workspace'
      ? `Adding to workspace: ${target.workspaceName}`
      : target?.kind === 'new-workspace'
        ? 'Starting a new workspace (fresh sandbox)'
        : undefined;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        className="flex flex-row w-full h-full min-h-0 bg-fl-background text-fl-foreground"
        data-testid="agents-layout"
      >
        <SessionsSidebar
          basePath={basePath}
          sessions={sessions.data ?? []}
          workspaces={workspaces.data ?? []}
          isLoading={sessions.isLoading || workspaces.isLoading}
          activeSessionId={sessionId}
          onNewWorkspace={openNewWorkspace}
          onNewChat={openNewChat}
        />

        <main className="flex-1 min-w-0 flex flex-col" data-testid="agents-main">
          {sessionId ? (
            activeSession.data ? (
              <ChatThread session={activeSession.data} />
            ) : activeSession.isLoading ? (
              <CenteredMessage>Loading chat…</CenteredMessage>
            ) : activeSession.error ? (
              <CenteredMessage>
                <span className="text-fl-destructive">
                  {(activeSession.error as Error).message}
                </span>
              </CenteredMessage>
            ) : (
              <CenteredMessage>Chat not found.</CenteredMessage>
            )
          ) : (
            <NoChatSelected onNewWorkspace={openNewWorkspace} />
          )}
        </main>

        <NewChatDialog
          open={target !== null}
          credentials={credentials.data ?? []}
          isLoading={credentials.isLoading}
          error={(credentials.error as Error | null) ?? null}
          isStarting={createSession.isPending}
          onCancel={closeDialog}
          onStart={handleStart}
          targetLabel={targetLabel}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}

function NoChatSelected({ onNewWorkspace }: { onNewWorkspace: () => void }): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <Bot className="size-10 mx-auto text-fl-muted-foreground/40" />
        <h2 className="mt-4 text-base font-semibold">No chat selected</h2>
        <p className="mt-1 text-sm text-fl-muted-foreground">
          Pick a chat from the sidebar, or start a new workspace.
        </p>
        <button
          type="button"
          onClick={onNewWorkspace}
          className="mt-4 inline-flex items-center rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90"
          data-testid="agents-empty-new-workspace"
        >
          + New workspace
        </button>
      </div>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-fl-muted-foreground">
      {children}
    </div>
  );
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export default AgentsLayout;
