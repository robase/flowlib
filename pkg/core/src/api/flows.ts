/**
 * Sub-API factory functions for creating namespaced API objects.
 *
 * Each factory closes over the ServiceFactory and relevant dependencies,
 * returning a simple object that delegates to the underlying services.
 * No initialization checks needed — these are only called after full init.
 */

import type { FlowsAPI } from './types';
import type { ServiceFactory } from '../services/service-factory';
import type { Logger } from '../schemas';
import * as Schemas from '../schemas';
import { FlowRunStatus } from '../types/base';
import type { DashboardStats } from '../flowlib-core';
import { FlowValidator } from '../services/flow-validator';
import { invectDefinitionSchema } from '../services/flow-versions/schemas-fresh';
import type { InvectDefinition } from '../services/flow-versions/schemas-fresh';

export function createFlowsAPI(sf: ServiceFactory, logger: Logger): FlowsAPI {
  const svc = sf.getFlowService();
  const renderer = sf.getReactFlowRendererService();
  const flowRunsService = sf.getFlowRunsService();

  return {
    create(data) {
      const parsed = Schemas.flow.createFlowRequestSchema.parse(data);
      return svc.createFlow(parsed);
    },

    list(options) {
      if (options) {
        Schemas.QueryOptionsSchema.parse(options);
      }
      return svc.listFlows(options);
    },

    get(flowId) {
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      return svc.getFlowById(id);
    },

    update(flowId, data) {
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      return svc.updateFlow(id, data);
    },

    delete(flowId) {
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      return svc.deleteFlow(id);
    },

    async validate(flowId, definition) {
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      logger.debug('Validating flow definition', { flowId: id });
      const parsed = invectDefinitionSchema.safeParse(definition);
      if (!parsed.success) {
        return {
          isValid: false,
          errors: parsed.error.issues.map((issue) => ({
            severity: 'error' as const,
            type: 'VALIDATION_SYSTEM_ERROR' as const,
            message: issue.path.length
              ? `${issue.path.join('.')}: ${issue.message}`
              : issue.message,
          })),
          warnings: [],
        };
      }
      const typedDefinition = parsed.data as InvectDefinition;
      return FlowValidator.validateFlowDefinition(typedDefinition);
    },

    renderToReactFlow(flowId, options) {
      logger.debug('renderToReactFlow called', { flowId, options });
      return renderer.renderToReactFlow(flowId, options);
    },

    async getDashboardStats(): Promise<DashboardStats> {
      logger.debug('getDashboardStats called');

      const [flowsResponse, runStats, recentRunsResponse] = await Promise.all([
        svc.listFlows({ pagination: { page: 1, limit: 1 } }),
        flowRunsService.getStats(),
        flowRunsService.listRuns({
          pagination: { page: 1, limit: 10 },
          sort: { sortBy: 'startedAt', sortOrder: 'desc' },
        }),
      ]);

      const totalRunsAll = Object.values(runStats.totalRuns).reduce((sum, c) => sum + c, 0);
      const totalSuccess = runStats.totalRuns[FlowRunStatus.SUCCESS] ?? 0;
      const successRate = totalRunsAll > 0 ? Math.round((totalSuccess / totalRunsAll) * 100) : 0;

      const activeCount =
        (runStats.totalRuns[FlowRunStatus.RUNNING] ?? 0) +
        (runStats.totalRuns[FlowRunStatus.PENDING] ?? 0) +
        (runStats.totalRuns[FlowRunStatus.PAUSED_FOR_BATCH] ?? 0);

      const recentRunsAll = Object.values(runStats.recentRuns).reduce((sum, c) => sum + c, 0);

      return {
        totalFlows: flowsResponse.pagination.totalPages,
        totalRuns: totalRunsAll,
        runsLast24h: recentRunsAll,
        activeRuns: activeCount,
        successRate,
        failedRunsLast24h: runStats.recentRuns[FlowRunStatus.FAILED] ?? 0,
        runsByStatus: runStats.totalRuns,
        recentRuns: recentRunsResponse.data,
      };
    },
  };
}
