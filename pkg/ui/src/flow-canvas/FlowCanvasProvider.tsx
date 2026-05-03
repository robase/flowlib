/**
 * FlowCanvasProvider — wires up the minimal provider tree required by the
 * flow editor when it runs outside the full `<Flowlib>` app.
 *
 * Unlike the hosted `<Flowlib>`:
 *   - no `BrowserRouter` on the outside — we always use a `MemoryRouter`
 *     with the single synthetic route `/flow-canvas/flow/__canvas__`
 *   - no `ApiProvider` pointing at a real backend — we inject an
 *     `InMemoryApiClient` seeded from props
 *   - no `PluginRegistryProvider` — plugins are a separate decoupling
 *     effort
 *   - no sidebar/shell — the embedding host owns its own chrome
 *
 * The provider keeps the internal `InMemoryApiClient` instance stable
 * across renders and mutates its state in place when props change, so
 * existing React Query caches don't get thrown away.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { MemoryRouter, useInRouterContext, useNavigate } from 'react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { ApiProvider } from '../contexts/ApiContext';
import { ThemeProvider, useOptionalTheme } from '../contexts/ThemeProvider';
import { NodeRegistryProvider } from '../contexts/NodeRegistryContext';
import { FrontendPathProvider } from '../contexts/FrontendPathContext';
import { ValidationProvider } from '../contexts/ValidationContext';
import { queryKeys } from '../api/query-keys';
import { useFlowEditorStore } from '../stores/flow-editor.store';
import { FlowActionsContext, type FlowActionsContextType } from '../routes/flow-route-layout';
import { InMemoryApiClient, type InMemoryCallbacks, type InMemoryState } from './InMemoryApiClient';
import { flowlibDefinitionToReactFlowData, reactFlowToFlowlibDefinition } from './flow-adapter';
import type { FlowCanvasProps } from './types';

// Stable synthetic flow ID used internally. Consumers never see this.
export const CANVAS_FLOW_ID = '__flow-canvas__';
export const CANVAS_BASE_PATH = '/flow-canvas';
export const CANVAS_EDIT_ROUTE = `${CANVAS_BASE_PATH}/flow/${CANVAS_FLOW_ID}`;
export const CANVAS_RUNS_ROUTE = `${CANVAS_BASE_PATH}/flow/${CANVAS_FLOW_ID}/runs`;
// Back-compat alias — used to be the only route.
export const CANVAS_ROUTE = CANVAS_EDIT_ROUTE;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // No stale-time — canvas state is authoritative via props.
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}

function useHasRouterContext(): boolean {
  try {
    return useInRouterContext();
  } catch {
    return false;
  }
}

/**
 * Applies the `themeTokens` prop as CSS custom properties on a wrapper
 * div. The host `<ThemeProvider>` still drives dark/light mode toggling;
 * this merely overrides individual tokens for the duration of the canvas.
 */
function ThemeTokenOverride({
  tokens,
  children,
  className,
}: {
  tokens: Partial<Record<string, string>> | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const style = useMemo(() => {
    if (!tokens) {
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(tokens)) {
      if (typeof v === 'string' && k.startsWith('--')) {
        out[k] = v;
      }
    }
    return out as React.CSSProperties;
  }, [tokens]);

  return (
    <div
      className={['fl-shell fl-flow-canvas relative w-full h-full', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * Internal component that keeps the Zustand store and React Query cache
 * in sync with the `flow` / `nodeRunStatus` props. This component must
 * render INSIDE the QueryClientProvider so `useQueryClient()` resolves.
 */
function FlowStateSync({
  flow,
  actions,
  nodeRunStatus,
  readonly,
  onEdit,
  runs,
  nodeExecutionsByRun,
}: Pick<
  FlowCanvasProps,
  'flow' | 'actions' | 'nodeRunStatus' | 'readonly' | 'onEdit' | 'runs' | 'nodeExecutionsByRun'
>) {
  const queryClient = useQueryClient();
  const setFlowId = useFlowEditorStore((s) => s.setFlowId);
  const syncFromServer = useFlowEditorStore((s) => s.syncFromServer);

  // Initialise the editor store with our synthetic flow ID once.
  useEffect(() => {
    setFlowId(CANVAS_FLOW_ID, '1');
  }, [setFlowId]);

  // Whenever the flow prop changes, rebuild the ReactFlow data and seed
  // both the React Query cache and the Zustand store.
  useEffect(() => {
    const rf = flowlibDefinitionToReactFlowData({ flow, actions, nodeRunStatus });
    queryClient.setQueryData(queryKeys.reactFlow(CANVAS_FLOW_ID, '1'), rf);
    // Cast to any[] to satisfy Node/Edge type parameters — the adapter
    // produces the shape the store expects.
    syncFromServer(
      rf.nodes as unknown as Parameters<typeof syncFromServer>[0],
      rf.edges as unknown as Parameters<typeof syncFromServer>[1],
      `${CANVAS_FLOW_ID}:1`,
    );
  }, [flow, actions, nodeRunStatus, queryClient, syncFromServer]);

  // Push runs / per-run node executions into the React Query cache so
  // `useFlowRuns`, `useFlowRun`, `useNodeExecutions` see them without
  // an extra round-trip. Same model as the SSE stream hook upstream.
  useEffect(() => {
    if (!runs) {
      return;
    }
    queryClient.setQueryData(queryKeys.executions(CANVAS_FLOW_ID), {
      data: runs,
      pagination: { limit: runs.length, offset: 0, total: runs.length, hasMore: false },
    });
    for (const r of runs) {
      queryClient.setQueryData(queryKeys.flowRun(r.id), r);
    }
  }, [runs, queryClient]);

  useEffect(() => {
    if (!nodeExecutionsByRun) {
      return;
    }
    for (const [runId, nodes] of Object.entries(nodeExecutionsByRun)) {
      queryClient.setQueryData(queryKeys.nodeExecutions(runId), nodes);
    }
  }, [nodeExecutionsByRun, queryClient]);

  // Forward structural mutations (node/edge changes) back out through
  // `onEdit`. Subscribes to the editor store directly so we catch every
  // write, not just user-level ones.
  const lastEmittedSnapshot = useRef<string | null>(null);
  useEffect(() => {
    if (readonly) {
      return;
    }
    // Seed the emitter with the current snapshot so we don't fire
    // `onEdit` for the initial sync.
    lastEmittedSnapshot.current = useFlowEditorStore.getState().currentSnapshot;
    const unsubscribe = useFlowEditorStore.subscribe((state) => {
      const snap = state.currentSnapshot;
      if (!snap || snap === lastEmittedSnapshot.current) {
        return;
      }
      lastEmittedSnapshot.current = snap;
      if (!onEdit) {
        return;
      }
      const def = reactFlowToFlowlibDefinition(state.nodes, state.edges);
      onEdit(def);
    });
    return unsubscribe;
  }, [readonly, onEdit]);

  return null;
}

interface FlowCanvasProviderProps extends FlowCanvasProps {
  children: React.ReactNode;
}

/**
 * Watches the host-controlled `viewRunId` prop and navigates the inner
 * MemoryRouter to the runs route (with `?runId=…`) when it changes. Pass
 * `null` (or omit) to navigate back to the edit route. Renders nothing.
 */
function ViewRunNavigator({ viewRunId }: { viewRunId?: string | null }): null {
  const navigate = useNavigate();
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (viewRunId === last.current) {
      return;
    }
    last.current = viewRunId;
    if (viewRunId === undefined) {
      return;
    } // never set — leave route alone
    if (viewRunId === null) {
      navigate(CANVAS_EDIT_ROUTE);
      return;
    }
    navigate(`${CANVAS_RUNS_ROUTE}?runId=${encodeURIComponent(viewRunId)}`);
  }, [viewRunId, navigate]);
  return null;
}

export function FlowCanvasProvider({
  flow,
  actions,
  readonly,
  onEdit,
  onRequestRun,
  onOpenCredentialManager,
  nodeRunStatus,
  themeTokens,
  className,
  children,
  runs,
  nodeExecutionsByRun,
  viewRunId,
  initialMode,
}: FlowCanvasProviderProps): React.ReactElement {
  // The QueryClient and API client are created once per provider
  // instance. Props mutations update the client's internal state.
  const queryClient = useMemo(() => makeQueryClient(), []);

  const apiClientRef = useRef<InMemoryApiClient | null>(null);
  if (!apiClientRef.current) {
    const state: InMemoryState = {
      flowId: CANVAS_FLOW_ID,
      flow,
      actions,
      credentials: [],
      agentTools: [],
      chatEnabled: false,
      nodeRunStatus,
      runs,
      nodeExecutionsByRun,
    };
    const callbacks: InMemoryCallbacks = {
      onEdit,
      onRequestRun,
      onOpenCredentialManager,
    };
    apiClientRef.current = new InMemoryApiClient(state, callbacks);
  }

  // Keep the API client's backing state in sync with props.
  useEffect(() => {
    apiClientRef.current?.setState({
      flowId: CANVAS_FLOW_ID,
      flow,
      actions,
      credentials: [],
      agentTools: [],
      chatEnabled: false,
      nodeRunStatus,
      runs,
      nodeExecutionsByRun,
    });
  }, [flow, actions, nodeRunStatus, runs, nodeExecutionsByRun]);

  useEffect(() => {
    apiClientRef.current?.setCallbacks({
      onEdit,
      onRequestRun,
      onOpenCredentialManager,
    });
  }, [onEdit, onRequestRun, onOpenCredentialManager]);

  const themeCtx = useOptionalTheme();
  const alreadyInRouter = useHasRouterContext();

  // Map prop callbacks → FlowActionsContext so the canvas's RunControls
  // (and anything else inside FlowEditor that uses `useFlowActions()`)
  // sees a real `onExecute`. Without this the Run button is disabled
  // because `disabled={isExecuting || !onExecute}` evaluates true.
  const [isExecuting, setIsExecuting] = useState(false);
  const onExecute = useCallback(async () => {
    if (!onRequestRun) {
      return;
    }
    setIsExecuting(true);
    try {
      // Inputs come from the consumer (extension host) — pass an empty
      // map; flows with inputs use defaults. Wiring an actual input prompt
      // is a future iteration.
      onRequestRun({});
    } finally {
      // Reset isExecuting opportunistically — host-side run completion
      // doesn't currently propagate back through this prop chain. The
      // canvas's `nodeRunStatus` prop still reflects per-node progress,
      // which is the more useful indicator anyway.
      setTimeout(() => setIsExecuting(false), 250);
    }
  }, [onRequestRun]);

  const flowActionsValue = useMemo<FlowActionsContextType>(
    () => ({
      onExecute,
      isExecuting,
      isTogglingActive: false,
      // Save / active toggle are routed through the consumer's onEdit;
      // there's no separate "save" concept in canvas-as-component land.
    }),
    [onExecute, isExecuting],
  );

  const body = (
    <QueryClientProvider client={queryClient}>
      <ApiProvider apiClient={apiClientRef.current}>
        <FrontendPathProvider basePath={CANVAS_BASE_PATH}>
          <ValidationProvider>
            <NodeRegistryProvider>
              <ReactFlowProvider>
                <FlowStateSync
                  flow={flow}
                  actions={actions}
                  nodeRunStatus={nodeRunStatus}
                  readonly={readonly}
                  onEdit={onEdit}
                  runs={runs}
                  nodeExecutionsByRun={nodeExecutionsByRun}
                />
                <ViewRunNavigator viewRunId={viewRunId} />
                <FlowActionsContext.Provider value={flowActionsValue}>
                  <ThemeTokenOverride tokens={themeTokens} className={className}>
                    {children}
                  </ThemeTokenOverride>
                </FlowActionsContext.Provider>
              </ReactFlowProvider>
            </NodeRegistryProvider>
          </ValidationProvider>
        </FrontendPathProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  const themed = themeCtx ? body : <ThemeProvider defaultTheme="dark">{body}</ThemeProvider>;
  // Pick the initial route. `viewRunId` (truthy) takes precedence over
  // `initialMode` because it carries strictly more information (which
  // run to preselect). Subsequent changes are handled by
  // <ViewRunNavigator> via imperative navigation.
  const initialEntry = viewRunId
    ? `${CANVAS_RUNS_ROUTE}?runId=${encodeURIComponent(viewRunId)}`
    : initialMode === 'runs'
      ? CANVAS_RUNS_ROUTE
      : CANVAS_EDIT_ROUTE;
  const routed = alreadyInRouter ? (
    themed
  ) : (
    <MemoryRouter initialEntries={[initialEntry]}>{themed}</MemoryRouter>
  );
  return routed;
}
