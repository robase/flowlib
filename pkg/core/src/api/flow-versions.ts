import type { FlowVersionsAPI } from './types';
import type { ServiceFactory } from '../services/service-factory';
import type { Logger } from '../schemas';
import * as Schemas from '../schemas';
import { createFlowVersionRequestSchema } from '../services/flow-versions/schemas-fresh';

export function createFlowVersionsAPI(sf: ServiceFactory, logger: Logger): FlowVersionsAPI {
  const svc = sf.getFlowVersionsService();
  const triggersService = sf.getTriggersService();

  return {
    async create(flowId, data) {
      logger.debug('createFlowVersion called', { flowId });
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      const parsed = createFlowVersionRequestSchema.parse(data);
      const version = await svc.createFlowVersion(id, parsed);

      // Sync trigger registrations from the new version's definition
      try {
        if (parsed.flowlibDefinition?.nodes) {
          await triggersService.syncTriggersForFlow(
            id,
            parsed.flowlibDefinition as {
              nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }>;
            },
          );
          logger.debug('Trigger registrations synced after version creation', {
            flowId: id,
            versionNumber: version.version,
          });
        }
      } catch (error) {
        logger.error('Failed to sync triggers after version creation', { flowId: id, error });
      }

      return version;
    },

    list(flowId, options) {
      logger.debug('listFlowVersions called', { flowId, options });
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      return svc.listFlowVersionsByFlowId(id, options);
    },

    get(flowId, version) {
      logger.debug('getFlowVersion called', { flowId, version });
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      return svc.getFlowVersion(id, version);
    },
  };
}
