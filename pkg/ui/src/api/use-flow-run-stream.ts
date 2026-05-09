/**
 * useFlowRunStream — replaces polling for a selected flow run with SSE.
 *
 * Opens a fetch-based SSE connection to GET /flow-runs/:flowRunId/stream.
 * On each event it updates the relevant React Query caches so every
 * existing consumer (FlowEditor, FlowStatusView, InspectViewport, logs panel)
 * stays in sync without any additional polling.
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
      // On terminal status, reconcile the node-executions cache from the DB.
      // SSE-fed updates are best-effort (events from before the stream
      // connected can be missed if the per-run DO buffer is recycled, and
      // first-event publishes can race against DO instance warmup). After the
      // run finishes, the DB has the canonical list — refetch as a safety
      // net so the Logs panel never gets stuck showing a node as Pending
      // because its create/update events were lost in transit.
      if (isTerminalStatus(event.flowRun.status)) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.nodeExecutions(flowRunId),
          exact: true,
        });
      }
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
        if (!prev || prev.length === 0) {
          return [event.nodeExecution];
        }
        // Upsert: when `node_execution.updated` arrives BEFORE the
        // corresponding `node_execution.created` (which can happen on
        // fast-failing nodes — both events fire microseconds apart, then
        // travel as separate `bus.emit` fetches to the per-run DO with no
        // ordering guarantee on the publish-side), `.map` would silently
        // drop the update. Append-if-missing keeps the failure visible in
        // the Logs panel; if the late-arriving `created` event lands after,
        // the existing dedup guard in the `created` case turns it into a
        // no-op so we don't clobber the fresher data.
        const idx = prev.findIndex((ne) => ne.id === event.nodeExecution.id);
        if (idx === -1) {
          return [...prev, event.nodeExecution];
        }
        const next = prev.slice();
        next[idx] = event.nodeExecution;
        return next;
      });
      invalidateReactFlow(queryClient, flowId);
      break;
    }

    case 'end': {
      queryClient.setQueryData(queryKeys.flowRun(flowRunId), event.flowRun);
      patchRunsList(queryClient, flowId, event.flowRun);
      ensureRunsListFresh(queryClient, flowId);
      invalidateReactFlow(queryClient, flowId);
      // Same reconcile as terminal `flow_run.updated` — see comment there.
      queryClient.invalidateQueries({
        queryKey: queryKeys.nodeExecutions(flowRunId),
        exact: true,
      });
      break;
    }

    // heartbeat — no-op, just keeps the connection alive
    case 'heartbeat':
      break;
  }
}

const TERMINAL_FLOW_RUN_STATUSES = new Set<string>(['SUCCESS', 'FAILED', 'CANCELLED']);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_FLOW_RUN_STATUSES.has(status);
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

/**
 * Coalesce repeated invalidations into a single trailing-edge refetch.
 *
 * Each SSE event used to call `invalidateReactFlow` directly, which forced
 * every active subscriber (typically 3+: editor canvas, run-scoped viewer,
 * status panel) to re-fetch the full ReactFlow graph. For a 6-node-event
 * run that meant ~18 redundant GETs of `/react-flow` even though the same
 * server-rendered graph was returned each time.
 *
 * Now we batch within a 75ms window per flowId. Bursts of node_execution
 * events (which arrive in tight clusters when the orchestrator advances
 * through a level of the DAG) collapse into one fetch. The trailing-edge
 * fire ensures the LAST state still wins — terminal events still trigger
 * the final invalidation as soon as the window elapses.
 */
const REACTFLOW_INVALIDATE_WINDOW_MS = 75;
const pendingReactFlowInvalidations = new Map<string, ReturnType<typeof setTimeout>>();

function invalidateReactFlow(queryClient: ReturnType<typeof useQueryClient>, flowId: string): void {
  const existing = pendingReactFlowInvalidations.get(flowId);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingReactFlowInvalidations.delete(flowId);
    queryClient.invalidateQueries({
      queryKey: ['flows', flowId, 'react-flow'],
    });
  }, REACTFLOW_INVALIDATE_WINDOW_MS);
  pendingReactFlowInvalidations.set(flowId, handle);
}

/**
 * Mark the runs-list query stale so any active observer refetches. Runs as a
 * safety net alongside `patchRunsList`: when the runs-list cache exists, the
 * patch already updated it (cheap, no network); when it doesn't (e.g. SSE
 * arrived before the first list fetch resolved), invalidate triggers the
 * pending fetch to use the fresh server state. Either way the dropdown ends
 * up showing the right status.
 *
 * Coalesced for the same reason as `invalidateReactFlow` — every SSE event
 * (snapshot, flow_run.updated, end) called this; collapsing into one trailing
 * fetch per burst keeps the dropdown fresh without the per-event refetch storm.
 */
const RUNSLIST_INVALIDATE_WINDOW_MS = 75;
const pendingRunsListInvalidations = new Map<string, ReturnType<typeof setTimeout>>();

function ensureRunsListFresh(queryClient: ReturnType<typeof useQueryClient>, flowId: string): void {
  const existing = pendingRunsListInvalidations.get(flowId);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingRunsListInvalidations.delete(flowId);
    queryClient.invalidateQueries({
      queryKey: queryKeys.executions(flowId),
    });
  }, RUNSLIST_INVALIDATE_WINDOW_MS);
  pendingRunsListInvalidations.set(flowId, handle);
}
