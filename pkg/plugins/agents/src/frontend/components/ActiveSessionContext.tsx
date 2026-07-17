/**
 * ActiveSessionContext — per-active-thread state surface.
 *
 * `useRemoteThreadListRuntime` invokes `runtimeHook` inside a tree
 * wrapped by the adapter's `unstable_Provider`. That wrapper is the
 * right place to instantiate per-session resources (the chat-stream
 * WebSocket, the history query) so they live exactly as long as the
 * thread is active. This context exposes those resources to
 * `useAgentRuntime` (which builds the assistant-ui runtime) and to
 * `ChatThread` (which needs stream status + loading flag for the
 * header / viewport).
 *
 * Only mounted when assistant-ui has a remoteId on the active
 * thread-list item; that always holds for our flow because sessions
 * are created externally by `AgentsLayout` and added to the adapter
 * list before they're activated.
 */
import * as React from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useChatStream } from '../hooks/useChatStream';
import { useSessionMessages } from '../hooks/useSessions';
import { AgentStreamProvider } from './AgentStreamContext';

export type ChatStreamHandle = ReturnType<typeof useChatStream>;
export type SessionMessagesQuery = ReturnType<typeof useSessionMessages>;

export interface ActiveSession {
  sessionId: string;
  stream: ChatStreamHandle;
  messagesQuery: SessionMessagesQuery;
}

const ActiveSessionContext = React.createContext<ActiveSession | null>(null);

/**
 * Read the active-session context. Returns null when called outside a
 * provider OR during the brief window before assistant-ui's
 * `switchToThread` has resolved a remoteId for the active thread — in
 * the hoisted-runtime setup, the `_RuntimeBinder` calls our runtimeHook
 * during initial mount, before the thread state is fully populated.
 * Callers must tolerate the null case (return a placeholder runtime
 * etc.) rather than throwing.
 */
export function useActiveSession(): ActiveSession | null {
  return React.useContext(ActiveSessionContext);
}

export function ActiveSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const stream = useChatStream(sessionId);
  const messagesQuery = useSessionMessages(sessionId);

  const value = React.useMemo<ActiveSession>(
    () => ({ sessionId, stream, messagesQuery }),
    [sessionId, stream, messagesQuery],
  );

  return (
    <ActiveSessionContext.Provider value={value}>
      <AgentStreamProvider
        controls={{
          permissionResponse: stream.permissionResponse,
          hilResponse: stream.hilResponse,
          resolvedPermissions: stream.resolvedPermissions,
          resolvedHumanInputs: stream.resolvedHumanInputs,
        }}
      >
        {children}
      </AgentStreamProvider>
    </ActiveSessionContext.Provider>
  );
}

/**
 * Adapter `unstable_Provider` body. Reads the active thread's
 * remoteId reactively; when present, mounts `ActiveSessionProvider`.
 * Renders `children` synchronously on first commit either way so the
 * `_RuntimeBinder` does not get stranded.
 */
export const AgentsThreadProviderInner: React.FC<React.PropsWithChildren> = ({ children }) => {
  // Always render `ActiveSessionProvider` (even with empty sessionId)
  // so the runtimeHook sees a context. The brief gap before
  // switchToThread resolves a remoteId is handled by useChatStream
  // and useSessionMessages, which both bail on empty sessionId.
  const remoteId = useAuiState((s) => s.threadListItem.remoteId) ?? '';
  return <ActiveSessionProvider sessionId={remoteId}>{children}</ActiveSessionProvider>;
};
