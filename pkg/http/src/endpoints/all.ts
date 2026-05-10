/**
 * Canonical ordered registry — the single source of truth for first-match
 * dispatchers (Next.js's catch-all, Nest's `@All('*')`).
 *
 * Order matters: more-specific paths come before broader ones across slices
 * so the matcher returns the right endpoint when patterns could otherwise
 * overlap (e.g. `/flows/:id/run` must match before `/flows/:id`). Within a
 * slice, individual endpoints are already ordered most-specific-first.
 *
 * For per-route dispatchers (Express's `router.get`/`router.post`), order
 * doesn't matter — Express does longest-prefix matching itself. But mounting
 * `allFirstPartyEndpoints` on Express still works and saves listing the
 * slices manually.
 *
 * The array is `readonly` to make it explicit that adapters shouldn't
 * mutate it. Adding a new slice means: create the slice file, append it
 * here in the right position, and every adapter picks it up automatically.
 */

import type { FlowlibHttpEndpoint } from './types';
import { agentEndpoints } from './agent';
import { chatEndpoints } from './chat';
import { credentialsEndpoints } from './credentials';
import { dashboardEndpoints } from './dashboard';
import { flowExecutionEndpoints } from './flow-execution';
import { flowRunsEndpoints } from './flow-runs';
import { flowsEndpoints } from './flows';
import { nodeDataEndpoints } from './node-data';
import { nodesEndpoints } from './nodes';
import { oauth2Endpoints } from './oauth2';
import { runEventsEndpoints } from './run-events';
import { settingsEndpoints } from './settings';
import { triggersEndpoints } from './triggers';

export const allFirstPartyEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  // SSE streams first — `/flow-runs/:id/stream` must match before any
  // shorter `/flow-runs/:id` pattern from the flow-runs slice.
  ...runEventsEndpoints,
  // Flow-execution paths (`/flows/:id/run`, `/flow-runs/ephemeral`,
  // `/runs/ephemeral`, `/node-executions/list`) before generic `/flows/:id`
  // and `/flow-runs/:id`.
  ...flowExecutionEndpoints,
  ...flowRunsEndpoints,
  // Triggers under `/flows/:flowId/triggers/*` — must come before
  // `/flows/:id/*` versions/react-flow patterns.
  ...triggersEndpoints,
  // OAuth2 under `/credentials/oauth2/*` — must come before
  // `/credentials/:id` patterns.
  ...oauth2Endpoints,
  ...credentialsEndpoints,
  ...chatEndpoints,
  ...nodeDataEndpoints,
  ...nodesEndpoints,
  ...agentEndpoints,
  ...dashboardEndpoints,
  // Settings — `/settings/descriptors` and `/settings/:key` are scoped
  // under their own prefix so ordering against other slices is irrelevant.
  ...settingsEndpoints,
  // Generic flow CRUD last — `/flows/:id` would otherwise shadow
  // `/flows/:id/run`, `/flows/:flowId/triggers`, etc.
  ...flowsEndpoints,
];
