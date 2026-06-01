/**
 * useChat Hook
 *
 * Manages the SSE streaming connection to POST /chat.
 * Reads events from the response body and dispatches them to the chat store.
 * Handles ui_action events from tools to refresh data and navigate.
 *
 * Messages are scoped per flow and automatically persisted to the backend.
 * When the active flowId changes, existing messages are saved and the new
 * flow's history is loaded from the server.
 */

import { useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../contexts/ApiContext';
import {
  useChatStore,
  useChatMessages,
  useChatStreaming,
  useChatStreamingText,
  useChatError,
  useChatLoadingHistory,
  useChatOpen,
  useChatSettings,
  useChatSettingsPanelOpen,
} from './chat.store';
import { useFlowEditorStore } from '~/stores/flow-editor.store';
import { queryKeys } from '../../api/query-keys';
import { getAllMemoryNotes, saveMemoryNote, deleteMemoryNote } from './chat-memory';
import type { ChatStreamEvent, ChatMessage } from './chat.store';

interface UseChatOptions {
  flowId?: string;
  selectedNodeId?: string;
  selectedRunId?: string;
  viewMode?: 'edit' | 'runs';
  basePath?: string;
}

export function useChat(options: UseChatOptions = {}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Reactive state (individual selectors — only re-render when the specific field changes)
  const messages = useChatMessages();
  const isStreaming = useChatStreaming();
  const streamingText = useChatStreamingText();
  const error = useChatError();
  const isLoadingHistory = useChatLoadingHistory();
  const isOpen = useChatOpen();
  const settings = useChatSettings();
  const isSettingsPanelOpen = useChatSettingsPanelOpen();

  // Actions (stable references, never trigger re-renders)
  const togglePanel = useChatStore((s) => s.togglePanel);
  const setOpen = useChatStore((s) => s.setOpen);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const toggleSettingsPanel = useChatStore((s) => s.toggleSettingsPanel);
  const updateSettings = useChatStore((s) => s.updateSettings);

  // Refs for stable access inside the streaming loop (avoids stale closures)
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const apiClientRef = useRef(apiClient);
  apiClientRef.current = apiClient;

  // ─── Flow-scoped history: load/save on flow switch ───

  // Save current messages to backend
  const saveMessages = useCallback(async () => {
    const state = useChatStore.getState();
    if (!state.activeFlowId || !state.isDirty() || state.messages.length === 0) {
      return;
    }
    try {
      await apiClientRef.current.saveChatMessages(
        state.activeFlowId,
        state.getSerializableMessages(),
      );
      state.markClean();
    } catch (err) {
      // Non-critical — log but don't disrupt UX
      console.warn('[chat] Failed to save messages:', err);
    }
  }, []);

  // Load messages from backend for a given flow
  const loadMessages = useCallback(async (flowId: string) => {
    const state = useChatStore.getState();
    state.setLoadingHistory(true);
    try {
      const records = await apiClientRef.current.getChatMessages(flowId);
      const messages: ChatMessage[] = records.map((r, idx) => ({
        id: r.id || `loaded_${idx}`,
        role: r.role,
        content: r.content,
        toolMeta: r.toolMeta ? (r.toolMeta as ChatMessage['toolMeta']) : undefined,
        createdAt: new Date(r.createdAt).getTime(),
      }));
      useChatStore.getState().loadMessages(messages);
    } catch (err) {
      console.warn('[chat] Failed to load messages:', err);
      useChatStore.getState().setLoadingHistory(false);
    }
  }, []);

  // When flowId changes, save old conversation and load new one
  useEffect(() => {
    const currentActiveFlow = useChatStore.getState().activeFlowId;
    const newFlowId = options.flowId ?? null;

    if (currentActiveFlow === newFlowId) {
      return;
    }

    // Save messages for the old flow (fire-and-forget)
    saveMessages();

    // Switch to new flow
    useChatStore.getState().setActiveFlow(newFlowId);

    // Load messages for the new flow
    if (newFlowId) {
      loadMessages(newFlowId);
    }
  }, [options.flowId, saveMessages, loadMessages]);

  // Save messages when the window is about to unload
  useEffect(() => {
    const onBeforeUnload = () => {
      const state = useChatStore.getState();
      if (!state.activeFlowId || !state.isDirty() || state.messages.length === 0) {
        return;
      }
      // Use fetch with keepalive for reliability on tab close
      const url = `${apiClientRef.current.getBaseURL()}/chat/messages/${state.activeFlowId}`;
      const body = JSON.stringify({ messages: state.getSerializableMessages() });
      fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // best-effort save on tab close — nothing to handle
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /**
   * Consume an SSE response body and dispatch events into the chat store.
   * Shared between a fresh POST /chat stream and a reattach GET /chat/stream/:id.
   *
   * Side-effects:
   *   - persists `sessionId` for the current flow on the first `session` event
   *   - persists the in-flight user message so a refresh can restore it
   *   - clears both on `done` / `error`
   *   - on unhandled disconnect, leaves the session id persisted so the next
   *     mount can reattach
   */
  const consumeChatStream = useCallback(
    async (
      response: Response,
      flowId: string | undefined,
      pendingUserMessage?: { id: string; content: string; createdAt: number },
    ) => {
      if (!response.body) {
        useChatStore.getState().setError('No response body from chat endpoint');
        return;
      }

      if (pendingUserMessage) {
        useChatStore.getState().setPendingUserMessage(flowId, pendingUserMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event: ChatStreamEvent = JSON.parse(data);
              if (event.type === 'session' && event.sessionId) {
                useChatStore.getState().setActiveSessionId(flowId, event.sessionId);
                continue;
              }
              handleEvent(event, useChatStore.getState(), {
                queryClient,
                navigate,
                optionsRef,
              });
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }
    },
    [queryClient, navigate],
  );

  const finalizeStream = useCallback(
    async (flowId: string | undefined) => {
      useChatStore.getState().finalizePendingToolCalls();
      useChatStore.getState().finalizeAssistantMessage();
      useChatStore.getState().setActiveSessionId(flowId, null);
      useChatStore.getState().setPendingUserMessage(flowId, null);
      await saveMessages();
    },
    [saveMessages],
  );

  const sendMessage = useCallback(
    async (content: string, opts?: { isEdit?: boolean }) => {
      const store = useChatStore.getState();
      if (store.isStreaming || !content.trim()) {
        return;
      }

      // Add user message to store
      const userMessageId = store.addUserMessage(content);
      const userMessage = store.messages.find((m) => m.id === userMessageId);

      // Build message history for the API (only user/assistant messages)
      const historyMessages = store.messages
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map((m) => ({ role: m.role, content: m.content }));

      // When this is an edit+resend, inject a system-level note so the LLM
      // knows the flow may contain nodes/edges from the deleted conversation.
      if (opts?.isEdit) {
        historyMessages.push({
          role: 'user' as const,
          content:
            '[Note: I edited an earlier message. The conversation was rewound to this point, ' +
            'but the flow may still contain nodes or edges from the previous conversation that ' +
            'no longer match this chat history. Please use get_current_flow_context to check ' +
            'the actual flow state before making changes.]\n\n' +
            content,
        });
      } else {
        historyMessages.push({ role: 'user' as const, content });
      }

      const flowId = optionsRef.current.flowId;
      const context = {
        flowId,
        selectedNodeId: optionsRef.current.selectedNodeId,
        selectedRunId: optionsRef.current.selectedRunId,
        viewMode: optionsRef.current.viewMode,
        maxSteps: useChatStore.getState().settings.maxSteps,
        credentialId: useChatStore.getState().settings.credentialId ?? undefined,
        model: useChatStore.getState().settings.model ?? undefined,
        memoryNotes: getAllMemoryNotes(optionsRef.current.flowId),
      };

      // Create abort controller
      const controller = new AbortController();
      useChatStore.getState().startStreaming(controller);

      try {
        const response = await apiClient.sendChatMessage(
          historyMessages,
          context,
          controller.signal,
        );

        await consumeChatStream(
          response,
          flowId,
          userMessage
            ? {
                id: userMessage.id,
                content: userMessage.content,
                createdAt: userMessage.createdAt,
              }
            : undefined,
        );

        await finalizeStream(flowId);
      } catch (error: unknown) {
        if ((error as Error).name === 'AbortError') {
          // User cancelled locally — the server-side session keeps running,
          // so leave the persisted sessionId in place. On mount, we'll
          // reattach unless it's been explicitly cleared by the Stop button.
          useChatStore.getState().finalizePendingToolCalls();
          useChatStore.getState().finalizeAssistantMessage();
          saveMessages();
          return;
        }
        // Clean up pending tool calls before showing the error
        useChatStore.getState().finalizePendingToolCalls();
        useChatStore.getState().setActiveSessionId(flowId, null);
        useChatStore.getState().setPendingUserMessage(flowId, null);
        saveMessages();
        const msg = (error as Error).message || 'Chat request failed';
        // Friendly error messages for common failures
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          useChatStore
            .getState()
            .setError('Connection lost — check that the server is running and try again.');
        } else if (msg.includes('503') || msg.includes('initializing')) {
          useChatStore
            .getState()
            .setError('Server is still starting up — please try again in a moment.');
        } else {
          useChatStore.getState().setError(msg);
        }
      }
    },
    [
      apiClient,
      consumeChatStream,
      finalizeStream,
      options.flowId,
      options.selectedNodeId,
      options.viewMode,
      queryClient,
      navigate,
      saveMessages,
    ],
  );

  // Wrap clearMessages to also delete from backend
  const clearMessages = useCallback(async () => {
    useChatStore.getState().clearMessages();
    const flowId = options.flowId;
    if (flowId) {
      try {
        await apiClient.deleteChatMessages(flowId);
        useChatStore.getState().markClean();
      } catch (err) {
        console.warn('[chat] Failed to delete messages on server:', err);
      }
    }
  }, [options.flowId, apiClient]);

  /**
   * Attempt to reattach to an in-flight session for the current flow. Called
   * on mount when a persisted sessionId is present. Replays buffered events
   * from the server then tails live ones until completion.
   *
   * If the server returns 404 (session evicted / server restarted), we clear
   * the persisted id and pending user message and carry on with the already-
   * loaded conversation history.
   */
  const reattachIfPending = useCallback(
    async (flowId: string | undefined) => {
      const store = useChatStore.getState();
      if (store.isStreaming) {
        return;
      } // Already streaming — don't double up.
      const sessionId = store.getActiveSessionId(flowId);
      if (!sessionId) {
        return;
      }

      // Restore the pending user message that kicked off this session, if any,
      // so the conversation reads correctly while we replay events.
      const pending = store.getPendingUserMessage(flowId);
      if (pending && !store.messages.some((m) => m.id === pending.id)) {
        useChatStore.setState((s) => {
          s.messages.push({
            id: pending.id,
            role: 'user',
            content: pending.content,
            createdAt: pending.createdAt,
          });
        });
      }

      // Reset streaming accumulators — the replay will rebuild them from zero.
      store.resetStreamingAccumulators();

      const controller = new AbortController();
      useChatStore.getState().startStreaming(controller);

      try {
        const response = await apiClient.reattachChatStream(sessionId, controller.signal);
        await consumeChatStream(response, flowId);
        await finalizeStream(flowId);
      } catch (error: unknown) {
        const name = (error as Error).name;
        const msg = (error as Error).message ?? '';
        if (name === 'AbortError') {
          useChatStore.getState().finalizePendingToolCalls();
          useChatStore.getState().finalizeAssistantMessage();
          return;
        }
        // Session not found / expired → treat as gone and forget it.
        if (
          msg.includes('404') ||
          msg.toLowerCase().includes('not found') ||
          msg.includes('expired')
        ) {
          console.info('[chat] Prior session expired, discarding', { sessionId });
          useChatStore.getState().setActiveSessionId(flowId, null);
          useChatStore.getState().setPendingUserMessage(flowId, null);
          useChatStore.getState().finalizePendingToolCalls();
          useChatStore.getState().finalizeAssistantMessage();
          return;
        }
        // Unknown failure — leave session id persisted for another try.
        useChatStore.getState().finalizePendingToolCalls();
        useChatStore.getState().setError(msg || 'Failed to reattach to chat stream');
      }
    },
    [apiClient, consumeChatStream, finalizeStream],
  );

  // On mount (and on flow switch after history loads), try to reattach.
  // We wait until history finishes loading so the replayed events layer on
  // top of the persisted conversation, not a blank slate.
  const hasAttemptedReattachRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoadingHistory) {
      return;
    }
    const flowId = options.flowId;
    const key = flowId ?? '__no_flow__';
    if (hasAttemptedReattachRef.current === key) {
      return;
    }
    hasAttemptedReattachRef.current = key;
    // Fire-and-forget — any errors surface through the chat error path.
    void reattachIfPending(flowId);
  }, [isLoadingHistory, options.flowId, reattachIfPending]);

  /**
   * User-initiated stop. Aborts the local SSE reader, fires a best-effort
   * DELETE so the server flips the agent loop's `aborted` flag, and clears
   * the persisted session so a refresh doesn't reattach to it.
   */
  const stopStreamingLocal = useCallback(() => {
    const flowId = options.flowId;
    const sessionId = useChatStore.getState().getActiveSessionId(flowId);
    if (sessionId) {
      // Fire-and-forget — the local abort below is what the user actually
      // sees; server-side cancellation is a billing/cost optimisation.
      apiClientRef.current.abortChatSession(sessionId).catch((err) => {
        console.warn('[chat] Server abort failed (local stop still applies):', err);
      });
    }
    useChatStore.getState().setActiveSessionId(flowId, null);
    useChatStore.getState().setPendingUserMessage(flowId, null);
    stopStreaming();
  }, [options.flowId, stopStreaming]);

  return {
    sendMessage,
    stopStreaming: stopStreamingLocal,
    clearMessages,
    messages,
    isStreaming,
    isLoadingHistory,
    streamingText,
    error,
    isOpen,
    togglePanel,
    setOpen,
    // Settings
    settings,
    isSettingsPanelOpen,
    toggleSettingsPanel,
    updateSettings,
  };
}

// =====================================
// UI Action Handler
// =====================================

/**
 * Trailing-edge debounce for `refresh_flow` invalidations, keyed by flowId.
 *
 * AI turns frequently fire multiple `refresh_flow` events in tight succession
 * — every node/edge/tool change in a multi-step plan emits one. Without
 * batching, each event invalidates `reactFlow + flowVersions + flow` and each
 * one fires a fetch per active subscriber.
 */
const REFRESH_FLOW_WINDOW_MS = 75;
const pendingRefreshFlow = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRefreshFlow(queryClient: ReturnType<typeof useQueryClient>, flowId: string): void {
  const existing = pendingRefreshFlow.get(flowId);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingRefreshFlow.delete(flowId);
    queryClient.invalidateQueries({ queryKey: queryKeys.reactFlow(flowId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.flowVersions(flowId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.flow(flowId) });
  }, REFRESH_FLOW_WINDOW_MS);
  pendingRefreshFlow.set(flowId, handle);
}

interface UiActionContext {
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  optionsRef: React.RefObject<UseChatOptions>;
}

/**
 * Handle a ui_action event from the chat stream.
 * Maps tool-emitted actions to query invalidation, navigation, and store updates.
 */
function handleUiAction(action: string, data: Record<string, unknown>, ctx: UiActionContext) {
  const { queryClient, navigate, optionsRef } = ctx;
  const basePath = optionsRef.current?.basePath ?? '';

  switch (action) {
    // ─── Flow was modified (new version published) ───
    case 'refresh_flow': {
      const flowId = (data.flowId as string) || optionsRef.current?.flowId;
      if (!flowId) {
        break;
      }

      // DO NOT call resetDirty() here — let syncFromServer's content-based guard decide.
      // If the user has unsaved local changes, syncFromServer will reject the incoming
      // data (snapshot mismatch). If the user has no local changes, it will apply cleanly.

      // Coalesce trailing-edge: a single AI turn can emit several `refresh_flow`
      // events (every node/edge/tool tool-call emits one). Without batching,
      // 5 tool calls × 3 invalidations × ≥1 subscriber each = 15+ refetches in
      // a tight burst. The trailing-edge fire still picks up the final state.
      scheduleRefreshFlow(queryClient, flowId);

      // Select a specific node if the tool requested it
      const selectNodeId = data.selectNodeId as string | undefined;
      if (selectNodeId) {
        // Small delay to let the refetch land before selecting
        setTimeout(() => {
          useFlowEditorStore.getState().selectNode(selectNodeId);
        }, 300);
      }
      break;
    }

    // ─── Navigate to a different flow ───
    case 'navigate_to_flow': {
      const flowId = data.flowId as string;
      if (!flowId) {
        break;
      }
      navigate(`${basePath}/flow/${flowId}`);
      break;
    }

    // ─── Open a flow run (after execution) ───
    case 'open_flow_run': {
      const flowId = (data.flowId as string) || optionsRef.current?.flowId;
      const flowRunId = data.flowRunId as string;
      if (!flowId || !flowRunId) {
        break;
      }

      // Invalidate runs list so it includes the new run
      queryClient.invalidateQueries({ queryKey: queryKeys.executions(flowId) });

      // Navigate to runs view with the specific run selected
      navigate(`${basePath}/flow/${flowId}/runs?runId=${flowRunId}`);
      break;
    }

    // ─── Open credential setup (handled by CredentialSetupBubble in chat UI) ───
    case 'open_credential_setup': {
      // No-op: the credential modal is rendered inline in the chat message bubble.
      break;
    }

    // ─── Plan tracking ───
    case 'show_plan':
    case 'update_plan': {
      const steps = data.steps as
        | Array<{
            index: number;
            title: string;
            status: string;
          }>
        | undefined;
      if (steps) {
        useChatStore.getState().setPlan({
          summary: (data.summary as string) ?? '',
          steps: steps.map((s) => ({
            index: s.index,
            title: s.title,
            status: s.status as 'pending' | 'in_progress' | 'done' | 'skipped',
          })),
        });
      }
      break;
    }

    // ─── Memory persistence (browser-local) ───
    case 'save_memory_note': {
      const scope = data.scope as 'flow' | 'workspace';
      const content = data.content as string;
      const flowId = data.flowId as string;
      if (content) {
        saveMemoryNote(scope, content, flowId || undefined);
      }
      break;
    }
    case 'delete_memory_note': {
      const scope = data.scope as 'flow' | 'workspace';
      const content = data.content as string;
      const flowId = data.flowId as string;
      if (content) {
        deleteMemoryNote(scope, content, flowId || undefined);
      }
      break;
    }

    default:
      console.log('[chat] Unhandled ui_action:', action, data);
  }
}

// =====================================
// Event Dispatcher
// =====================================

/**
 * Dispatch a single SSE event to the chat store.
 */
function handleEvent(
  event: ChatStreamEvent,
  store: ReturnType<typeof useChatStore.getState>,
  uiCtx: UiActionContext,
) {
  switch (event.type) {
    case 'text_delta':
      if (event.text) {
        store.appendStreamingText(event.text);
      }
      break;

    case 'reasoning_delta':
      if (event.text) {
        store.appendStreamingReasoning(event.text);
      }
      break;

    case 'tool_call_start':
      if (event.toolName && event.toolCallId) {
        store.addToolCallMessage(event.toolName, event.toolCallId, event.args ?? {});
      }
      break;

    case 'tool_call_result':
      if (event.toolCallId && event.result) {
        store.updateToolCallResult(event.toolCallId, event.result);
      }
      break;

    case 'error':
      if (event.message) {
        store.setError(event.message);
      }
      break;

    case 'done':
      // Stream complete — finalizeAssistantMessage is called by the main loop
      break;

    case 'suggestions':
      if (event.suggestions && Array.isArray(event.suggestions)) {
        useChatStore.getState().setSuggestions(event.suggestions);
      }
      break;

    case 'ui_action':
      if (event.action) {
        handleUiAction(event.action, event.data ?? {}, uiCtx);
      }
      break;
  }
}
