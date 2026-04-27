/**
 * useFlowRunStream — replaces polling for a selected flow run with SSE.
 *
 * Opens a fetch-based SSE connection to GET /flow-runs/:flowRunId/stream.
 * On each event it updates the relevant React Query caches so every
 * existing consumer (FlowRunsView, FlowStatusView, logs panel) stays in sync
 * without any additional polling.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys } from './query-keys';
import type {
  ExecutionStreamEvent,
  FlowRun,
  NodeExecution,
  PaginatedResponse,
} from '@flowlib/core/types';

/**
 * Subscribe to real-time execution events for a flow run.
 *
 * While the stream is open the hook writes directly into React Query caches:
 *  • queryKeys.flowRun(flowRunId)        — FlowRun object
 *  • queryKeys.nodeExecutions(flowRunId) — NodeExecution[]
 *  • queryKeys.executions(flowId)        — PaginatedResponse<FlowRun> (runs list)
 *
 * The stream closes automatically when the run reaches a terminal status,
 * when the component unmounts, or when flowRunId changes.
 */
export function useFlowRunStream(flowId: string, flowRunId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!flowRunId) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    (async () => {
      try {
        const response = await apiClient.rawRequest(`/flow-runs/${flowRunId}/stream`, {
          signal: controller.signal,
          headers: {
            Accept: 'text/event-stream',
          },
        });

        if (!response.ok || !response.body) {
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE frames
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) {
              continue;
            }

            const json = line.slice(6);
            let event: ExecutionStreamEvent;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }

            applyEvent(event, flowId, flowRunId, queryClient);
          }
        }
      } catch (err: unknown) {
        // AbortError is expected on cleanup
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.warn('[SSE] stream error, falling back to polling', err);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      abortRef.current = null;
    };
  }, [flowId, flowRunId, apiClient, queryClient]);
}

// ---------------------------------------------------------------------------
// Cache update helpers
// ---------------------------------------------------------------------------

function applyEvent(
  event: ExecutionStreamEvent,
  flowId: string,
  flowRunId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  switch (event.type) {
    case 'snapshot': {
      // Seed both caches from the initial snapshot
      queryClient.setQueryData(queryKeys.flowRun(flowRunId), event.flowRun);
      queryClient.setQueryData(queryKeys.nodeExecutions(flowRunId), event.nodeExecutions);
      patchRunsList(queryClient, flowId, event.flowRun);
      ensureRunsListFresh(queryClient, flowId);
      // Invalidate the React Flow graph so it re-renders with execution status
      invalidateReactFlow(queryClient, flowId);
      break;
    }

    case 'flow_run.updated': {
      queryClient.setQueryData(queryKeys.flowRun(flowRunId), event.flowRun);
      patchRunsList(queryClient, flowId, event.flowRun);
      // Defensive backstop: if the runs-list cache wasn't populated yet
      // (race between mount and first SSE event), patchRunsList silently
      // bails. Marking the query stale so the next observer refetches keeps
      // the dropdown's status badge in sync — particularly important for the
      // terminal flow_run.updated event (RUNNING → FAILED / SUCCESS).
      ensureRunsListFresh(queryClient, flowId);
      invalidateReactFlow(queryClient, flowId);
      break;
    }

    case 'node_execution.created': {
      queryClient.setQueryData<NodeExecution[]>(queryKeys.nodeExecutions(flowRunId), (prev) => {
        if (!prev) {
          return [event.nodeExecution];
        }
        // Avoid duplicates (defensive)
        if (prev.some((ne) => ne.id === event.nodeExecution.id)) {
          return prev;
        }
        return [...prev, event.nodeExecution];
      });
      invalidateReactFlow(queryClient, flowId);
      break;
    }

    case 'node_execution.updated': {
      queryClient.setQueryData<NodeExecution[]>(queryKeys.nodeExecutions(flowRunId), (prev) => {
        if (!prev) {
          return [event.nodeExecution];
        }
        return prev.map((ne) => (ne.id === event.nodeExecution.id ? event.nodeExecution : ne));
      });
      invalidateReactFlow(queryClient, flowId);
      break;
    }

    case 'end': {
      queryClient.setQueryData(queryKeys.flowRun(flowRunId), event.flowRun);
      patchRunsList(queryClient, flowId, event.flowRun);
      ensureRunsListFresh(queryClient, flowId);
      invalidateReactFlow(queryClient, flowId);
      break;
    }

    // heartbeat — no-op, just keeps the connection alive
    case 'heartbeat':
      break;
  }
}

/** Update a single run inside the runs-list cache without refetching. */
function patchRunsList(
  queryClient: ReturnType<typeof useQueryClient>,
  flowId: string,
  flowRun: FlowRun,
): void {
  queryClient.setQueryData<PaginatedResponse<FlowRun>>(queryKeys.executions(flowId), (prev) => {
    if (!prev) {
      return prev;
    }
    const idx = prev.data.findIndex((r) => r.id === flowRun.id);
    if (idx === -1) {
      // New run — prepend
      return { ...prev, data: [flowRun, ...prev.data] };
    }
    const updated = [...prev.data];
    updated[idx] = flowRun;
    return { ...prev, data: updated };
  });
}

/** Invalidate the React Flow graph query so it re-fetches with updated execution status. */
function invalidateReactFlow(queryClient: ReturnType<typeof useQueryClient>, flowId: string): void {
  // Invalidate all reactFlow queries for this flow (any version / any flowRunId)
  queryClient.invalidateQueries({
    queryKey: ['flows', flowId, 'react-flow'],
  });
}

/**
 * Mark the runs-list query stale so any active observer refetches. Runs as a
 * safety net alongside `patchRunsList`: when the runs-list cache exists, the
 * patch already updated it (cheap, no network); when it doesn't (e.g. SSE
 * arrived before the first list fetch resolved), invalidate triggers the
 * pending fetch to use the fresh server state. Either way the dropdown ends
 * up showing the right status.
 */
function ensureRunsListFresh(queryClient: ReturnType<typeof useQueryClient>, flowId: string): void {
  queryClient.invalidateQueries({
    queryKey: queryKeys.executions(flowId),
  });
}
