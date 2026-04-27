/**
 * FlowCanvas — the headless, decoupled flow editor entry point.
 *
 * Contract C in `VSCODE_EXTENSION_TASKS.md` §3.2. Takes all data and
 * configuration via props; renders the same visual editor as the full
 * `<Flowlib>` component but without `ApiProvider` (a prop-backed
 * `InMemoryApiClient` replaces it) or `PluginRegistryProvider`.
 *
 * Two routes live inside the canvas's MemoryRouter:
 *   - `/flow-canvas/flow/__canvas__`        → `<FlowEditor>` (edit)
 *   - `/flow-canvas/flow/__canvas__/runs`   → `<FlowRunsView>` (runs)
 *
 * The `Edit | Runs` toggle in the toolbar uses `useNavigate()` to switch
 * between them. Hosts can also drive navigation programmatically via the
 * `viewRunId` / `initialMode` props.
 *
 * Usage:
 *
 *   <FlowCanvas
 *     flow={definition}
 *     actions={actionCatalogue}
 *     onEdit={(next) => persistToDisk(next)}
 *     onRequestRun={(inputs) => postMessageToHost({ type: 'run', inputs })}
 *     runs={recentRuns}
 *     nodeExecutionsByRun={execsByRunId}
 *     viewRunId={selectedRunId}  // drives mode + selection
 *   />
 */

import React from 'react';
import { Route, Routes } from 'react-router';
import { FlowCanvasProvider, CANVAS_FLOW_ID, CANVAS_BASE_PATH } from './FlowCanvasProvider';
import { FlowEditor } from '../components/flow-editor/FlowEditor';
import { FlowRunsView } from '../components/flow-viewer/FlowRunsView';
import type { FlowCanvasProps } from './types';

export function FlowCanvas(props: FlowCanvasProps): React.ReactElement {
  return (
    <FlowCanvasProvider {...props}>
      <Routes>
        {/*
         * Both routes mount under `/flow-canvas/flow/:flowId`. The flow
         * id is the synthetic CANVAS_FLOW_ID; `:flowId` matches it but
         * `useParams()` will surface it for the underlying components
         * (which read `flowId` to scope React Query keys).
         */}
        <Route
          path={`${CANVAS_BASE_PATH}/flow/:flowId`}
          element={
            <FlowEditor flowId={CANVAS_FLOW_ID} flowVersion="1" basePath={CANVAS_BASE_PATH} />
          }
        />
        <Route
          path={`${CANVAS_BASE_PATH}/flow/:flowId/runs`}
          element={<FlowRunsView flowId={CANVAS_FLOW_ID} basePath={CANVAS_BASE_PATH} />}
        />
        <Route
          path={`${CANVAS_BASE_PATH}/flow/:flowId/runs/version/:version`}
          element={<FlowRunsView flowId={CANVAS_FLOW_ID} basePath={CANVAS_BASE_PATH} />}
        />
      </Routes>
    </FlowCanvasProvider>
  );
}

FlowCanvas.displayName = 'FlowCanvas';
