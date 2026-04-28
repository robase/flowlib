import type { TestingAPI } from './types';
import type { ServiceFactory } from '../services/service-factory';
import type { ActionRegistry } from '@flowlib/actions/registry';
import type { JsExpressionService, TemplateService } from '../services/templating';
import type { Logger, FlowlibConfig } from '../schemas';
import type { NodeExecutionContext } from '../types.internal';
import type { SubmitPromptRequest } from '../services/node-data.service';
import { NodeExecutionStatus } from '../types/base';
import { detectProviderFromCredential } from '../utils/provider-detection';
import type { BatchProvider } from '../services/ai/base-client';

/**
 * Resolve {{ expression }} templates in params using the provided context.
 */
async function resolveTemplateParams(
  templateService: TemplateService,
  logger: Logger,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
  skipKeys: string[] = [],
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (skipKeys.includes(key)) {
      resolved[key] = value;
      continue;
    }

    if (typeof value === 'string' && templateService.isTemplate(value)) {
      try {
        const renderedValue = await templateService.render(value, context);
        resolved[key] = renderedValue;
      } catch (error) {
        logger.warn('Failed to resolve template param for test', {
          param: key,
          template: value,
          error: error instanceof Error ? error.message : String(error),
        });
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

export function createTestingAPI(
  sf: ServiceFactory,
  actionRegistry: ActionRegistry,
  jsExpressionService: JsExpressionService | null,
  templateService: TemplateService | null,
  config: FlowlibConfig,
): TestingAPI {
  const logger = config.logger;
  const nodeDataService = sf.getNodeDataService();
  const baseAIClient = sf.getBaseAIClient();
  const credentialsService = sf.getCredentialsService();

  async function ensureAdapterForCredential(
    credentialId: string,
    providerHint?: BatchProvider | string,
  ): Promise<void> {
    if (providerHint && baseAIClient.hasAdapter(providerHint as BatchProvider)) {
      return;
    }
    const credential = await credentialsService.getDecryptedWithRefresh(credentialId);
    const apiKey = (credential.config as Record<string, unknown>)?.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error(`Credential "${credentialId}" does not contain an apiKey.`);
    }
    const detected = detectProviderFromCredential(credential);
    if (!detected) {
      throw new Error(`Unable to detect AI provider from credential "${credentialId}".`);
    }
    if (baseAIClient.hasAdapter(detected)) {
      return;
    }
    const { BatchProvider: BP } = await import('../services/ai/base-client');
    const label =
      detected === BP.OPENAI ? 'OPENAI' : detected === BP.ANTHROPIC ? 'ANTHROPIC' : 'OPENROUTER';
    baseAIClient.registerAdapter(label, apiKey);
  }

  return {
    async testNode(nodeType, params, inputData = {}) {
      const action = actionRegistry.get(nodeType);
      if (!action) {
        throw new Error(`Unknown node type: ${nodeType}`);
      }

      const defaultParams: Record<string, unknown> = Object.fromEntries(
        (action.params.fields ?? [])
          .filter((f) => f.defaultValue !== undefined)
          .map((f) => [f.name, f.defaultValue]),
      );
      const mergedParams = { ...defaultParams, ...params };

      const skipTemplateResolutionKeys: string[] = [];
      if (nodeType === 'core.template_string') {
        skipTemplateResolutionKeys.push('template');
      }

      let resolvedParams = mergedParams;
      if (templateService) {
        resolvedParams = await resolveTemplateParams(
          templateService,
          logger,
          mergedParams,
          inputData,
          skipTemplateResolutionKeys,
        );
      }

      logger.debug('Test node with resolved params', {
        nodeType,
        resolvedParams,
        inputDataKeys: Object.keys(inputData),
      });

      try {
        const { executeActionAsNode } = await import('@flowlib/actions');

        const mockContext: NodeExecutionContext = {
          nodeId: `test-${Date.now()}`,
          flowRunId: `test-run-${Date.now()}`,
          logger,
          globalConfig: {},
          flowInputs: {},
          flowParams: { useBatchProcessing: false },
          incomingData: inputData,
          functions: {
            markDownstreamNodesAsSkipped: () => {
              /* noop */
            },
            runTemplateReplacement: async (
              template: string,
              variables: Record<string, unknown>,
            ) => {
              if (!templateService) {
                return template;
              }
              const result = await templateService.render(template, variables);
              if (result === null || result === undefined) {
                return '';
              }
              if (typeof result === 'object') {
                return JSON.stringify(result);
              }
              return String(result);
            },
            submitPrompt: async (request: SubmitPromptRequest) =>
              baseAIClient.executePrompt(request),
            getCredential: async (credentialId: string) =>
              credentialsService.getDecryptedWithRefresh(credentialId),
          },
          allNodeOutputs: new Map(),
        } as unknown as NodeExecutionContext;

        const result = await executeActionAsNode(action, resolvedParams, mockContext);

        if (result.state === NodeExecutionStatus.SUCCESS) {
          let output: Record<string, unknown> | undefined;
          if (result.output?.data?.variables) {
            output = Object.fromEntries(
              Object.entries(result.output.data.variables).map(([k, v]) => [
                k,
                (v as { value: unknown }).value,
              ]),
            );
          } else if (result.output) {
            output = result.output as unknown as Record<string, unknown>;
          }
          return { success: true, output };
        } else if (result.state === NodeExecutionStatus.FAILED) {
          return {
            success: false,
            error: result.errors?.join(', ') || 'Node execution failed',
            ...(result.fieldErrors && { fieldErrors: result.fieldErrors }),
          };
        } else {
          return { success: true, output: { status: 'pending' } };
        }
      } catch (error) {
        logger.error('Test node execution failed', { error, nodeType });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    testJsExpression(request) {
      if (!jsExpressionService) {
        return Promise.resolve({ success: false, error: 'JS expression engine not initialized' });
      }
      return jsExpressionService.evaluate(request.expression, request.context).then(
        (result) => ({ success: true as const, result }),
        (e) => ({
          success: false as const,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    testMapper(request) {
      if (!jsExpressionService) {
        return Promise.resolve({ success: false, error: 'JS expression engine not initialized' });
      }
      return jsExpressionService.evaluate(request.expression, request.incomingData).then(
        (result) => {
          const mode = request.mode ?? 'auto';
          const isArray = Array.isArray(result);
          let resultType: 'array' | 'object' | 'primitive';

          if (isArray) {
            resultType = 'array';
          } else if (result !== null && typeof result === 'object') {
            resultType = 'object';
          } else {
            resultType = 'primitive';
          }

          if (mode === 'iterate' && !isArray) {
            return {
              success: false as const,
              error: `Mode is "iterate" but expression returned ${resultType}, not an array`,
            };
          }

          return {
            success: true as const,
            result,
            resultType,
            itemCount: isArray ? (result as unknown[]).length : undefined,
          };
        },
        (e) => ({
          success: false as const,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    async testModelPrompt(request) {
      if (request.credentialId) {
        await ensureAdapterForCredential(request.credentialId, request.provider);
      }
      return baseAIClient.executePrompt(request);
    },

    getAvailableModels() {
      return nodeDataService.getAvailableModels();
    },

    async getModelsForProvider(provider) {
      if (!provider) {
        throw new Error('Provider is required to list models');
      }
      const result = await nodeDataService.getModelsForProvider(provider);
      return { provider, ...result };
    },

    async getModelsForCredential(credentialId) {
      if (!credentialId) {
        throw new Error('credentialId is required to list models');
      }
      const credential = await credentialsService.get(credentialId);
      const provider = detectProviderFromCredential(credential);
      if (!provider) {
        throw new Error(
          'Unable to detect provider from credential. Ensure the credential has an API URL or provider hint.',
        );
      }
      const result = await nodeDataService.getModelsForProvider(provider);
      return { provider, ...result };
    },
  };
}
