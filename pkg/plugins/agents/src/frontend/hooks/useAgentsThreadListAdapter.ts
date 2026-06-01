/**
 * useAgentsThreadListAdapter — bridges assistant-ui's
 * `useRemoteThreadListRuntime` to the agents plugin's REST API.
 *
 * Mapping:
 *   - assistant-ui `remoteId`   ↔ agents `session.id`
 *   - `externalId`              left undefined; assistant-ui's
 *     `switchToThread` accepts either threadId or remoteId, so the URL
 *     can drive switching by session.id directly.
 *
 * Session creation is handled externally by `NewChatDialog` →
 * `POST /sessions`; this adapter's `initialize()` is therefore a
 * passthrough (returns the threadId as remoteId without touching the
 * backend). After the dialog succeeds, the caller invalidates the
 * sessions query so `list()` picks up the new thread.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RemoteThreadListAdapter } from '@assistant-ui/react';
import { useAgentsApiClients } from '../api/context';
import type { AgentSession } from '../../shared/types';
import { sessionsKeys } from './useSessions';
import { AgentsThreadProviderInner } from '../components/ActiveSessionContext';

// Inlined to avoid depending on @assistant-ui/core's subpath, which is
// not re-exported from @assistant-ui/react.
type RemoteThreadMetadata = {
  readonly status: 'regular' | 'archived';
  readonly remoteId: string;
  readonly externalId?: string | undefined;
  readonly title?: string | undefined;
};

function toMetadata(session: AgentSession): RemoteThreadMetadata {
  return {
    status: session.status === 'archived' ? 'archived' : 'regular',
    remoteId: session.id,
    title: session.title ?? 'New chat',
  };
}

export function useAgentsThreadListAdapter(): RemoteThreadListAdapter {
  const { sessions } = useAgentsApiClients();
  const qc = useQueryClient();

  return useMemo<RemoteThreadListAdapter>(
    () => ({
      list: async () => {
        const r = await sessions.listSessions();
        // Cache the response under the same key React Query uses so
        // direct `useSessions()` callers benefit from the fetch.
        qc.setQueryData(sessionsKeys.list(), r.data);
        return { threads: r.data.map(toMetadata) };
      },

      fetch: async (threadId) => {
        const session = await sessions.getSession(threadId);
        qc.setQueryData(sessionsKeys.detail(threadId), session);
        return toMetadata(session);
      },

      rename: async (threadId, newTitle) => {
        const updated = await sessions.updateSession(threadId, { title: newTitle });
        qc.setQueryData(sessionsKeys.detail(threadId), updated);
        qc.invalidateQueries({ queryKey: sessionsKeys.list() });
      },

      archive: async (threadId) => {
        const updated = await sessions.updateSession(threadId, { status: 'archived' });
        qc.setQueryData(sessionsKeys.detail(threadId), updated);
        qc.invalidateQueries({ queryKey: sessionsKeys.list() });
      },

      unarchive: async (threadId) => {
        const updated = await sessions.updateSession(threadId, { status: 'active' });
        qc.setQueryData(sessionsKeys.detail(threadId), updated);
        qc.invalidateQueries({ queryKey: sessionsKeys.list() });
      },

      delete: async (threadId) => {
        await sessions.deleteSession(threadId);
        qc.invalidateQueries({ queryKey: sessionsKeys.list() });
      },

      // Sessions are created externally via NewChatDialog. When
      // assistant-ui asks to initialize a thread we treat the threadId
      // as already-resolved and return it unchanged. (Never called in
      // the dialog-driven flow, but kept conformant for completeness.)
      initialize: async (threadId) => ({
        remoteId: threadId,
        externalId: undefined,
      }),

      // No backend support for auto-titles yet. Returning a closed
      // stream is the documented no-op shape.
      generateTitle: async () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),

      // Per-active-thread wrapper. assistant-ui renders this around
      // the runtime binder for each active thread. We use it to mount
      // the chat-stream WS + history query at the right scope; see
      // ActiveSessionContext for the body.
      unstable_Provider: AgentsThreadProviderInner,
    }),
    [sessions, qc],
  );
}
