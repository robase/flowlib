import type { ActionsAPI } from './types';
import type { ActionRegistry } from '../actions';
import type { ServiceFactory } from '../services/service-factory';
import type { Logger } from '../schemas';
import { ValidationError } from '../types/common/errors.types';

export function createActionsAPI(
  actionRegistry: ActionRegistry,
  sf: ServiceFactory,
  logger: Logger,
): ActionsAPI {
  return {
    getRegistry() {
      return actionRegistry;
    },

    register(action) {
      actionRegistry.register(action);
    },

    getProviders() {
      return actionRegistry.getProviders();
    },

    getForProvider(providerId) {
      return actionRegistry.getActionsForProvider(providerId);
    },

    getAvailableNodes() {
      const allDefs = actionRegistry.getAllNodeDefinitions();
      for (const def of allDefs) {
        if (!def.provider) {
          def.provider = { id: 'core', name: 'Flowlib Core', icon: 'Blocks' };
        }
      }
      return allDefs;
    },

    async handleConfigUpdate(event) {
      if (!event?.nodeType) {
        throw new ValidationError('nodeType is required for node config updates');
      }

      if (!event.params || typeof event.params !== 'object') {
        event.params = {};
      }

      const configContext = {
        logger,
        services: {
          credentials: sf.getCredentialsService(),
          baseAIClient: sf.getBaseAIClient(),
        },
      };

      const action = actionRegistry.get(event.nodeType as string);
      if (action) {
        if (action.onConfigUpdate) {
          return action.onConfigUpdate(
            { ...event, nodeType: event.nodeType as string },
            configContext,
          );
        }

        const definition = actionRegistry.toNodeDefinition(event.nodeType as string);
        if (definition) {
          return { definition, params: event.params };
        }
      }

      throw new ValidationError(`Unknown node type '${event.nodeType}' for config update`);
    },

    resolveFieldOptions(actionId, fieldName, deps) {
      const context = {
        logger,
        services: {
          credentials: sf.getCredentialsService(),
        },
      };
      return actionRegistry.resolveFieldOptions(actionId, fieldName, deps, context);
    },
  };
}
