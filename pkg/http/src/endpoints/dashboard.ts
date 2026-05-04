/**
 * Dashboard endpoint slice.
 *
 *   GET /dashboard/stats
 *
 * Single endpoint, kept in its own slice for symmetry with other domains —
 * the `/agent/*` surface lives in `agent.ts`.
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const dashboardStats = defineEndpoint({
  id: 'dashboard.stats',
  method: 'GET',
  path: '/dashboard/stats',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.flows.getDashboardStats(),
    };
  },
});

export const dashboardEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  dashboardStats,
] as readonly FlowlibHttpEndpoint<unknown>[];
