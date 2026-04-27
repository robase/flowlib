import { NodeExecutionStatus } from 'src/types/base';
import { NodeExecutionContext } from 'src/types.internal';
import { InvectDefinition, FlowEdge, FlowNodeDefinitions } from '../flow-versions/schemas-fresh';
import { NodeOutput, NodeIncomingDataObject } from 'src/types/node-io-types';
import { generateNodeSlug } from 'src/utils/node-slug';
import type { NodeExecution } from '../node-executions/node-executions.model';
import type { NodeExecutionService } from '../node-executions/node-execution.service';
import type { NodeDataService } from '../node-data.service';
import type { Logger } from 'src/schemas';
import type { GraphService } from '../graph.service';
import type { CredentialsService } from '../credentials/credentials.service';
import type { BaseAIClient } from '../ai/base-client';
import { BatchProvider } from '../ai/base-client';
import type { PluginHookRunner } from 'src/types/plugin.types';
import { detectProviderFromCredential } from 'src/utils/provider-detection';
import { TemplateService, createTemplateService } from '../templating/template.service';
import type { JsExpressionService } from '../templating/js-expression.service';
import type { MapperConfig } from '../flow-versions/schemas-fresh';
import { getGlobalActionRegistry } from 'src/actions/action-registry';
import { executeActionAsNode } from 'src/actions/action-executor';
import { classifyError } from '@flowlib/action-kit';

export type NodeExecutionCoordinatorDeps = {
  logger: Logger;
  nodeExecutionService: NodeExecutionService;
  nodeDataService: NodeDataService;
  graphService: GraphService;
  credentialsService?: CredentialsService;
  nodeExecutionServiceForTools?: NodeExecutionService;
  templateService?: TemplateService;
  jsExpressionService?: JsExpressionService;
  baseAIClient: BaseAIClient;
  /** Plugin hook runner for node execution hooks (optional for backward compat). */
  pluginHookRunner?: PluginHookRunner;
};

/**
 * Coordinates the execution of individual nodes within a flow run.
 */
export class NodeExecutionCoordinator {
  private templateService: TemplateService;

  constructor(private readonly deps: NodeExecutionCoordinatorDeps) {
    if (deps.templateService) {
      this.templateService = deps.templateService;
    } else if (deps.jsExpressionService) {
      this.templateService = createTemplateService(deps.jsExpressionService, deps.logger);
    } else {
      // Fallback: TemplateService requires JsExpressionService. If neither is
      // provided the service will throw at render time — but construction
      // should not fail so tests that never call resolveTemplateParams still work.
      this.templateService = createTemplateService(
        undefined as unknown as JsExpressionService,
        deps.logger,
      );
    }
  }

  /**
   * Ensure a provider adapter is registered in BaseAIClient for the given
   * provider. If the adapter doesn't exist yet, the credential is resolved
   * and its API key is used to create one on-the-fly.
   */
  private async ensureAdapterRegistered(
    provider: BatchProvider,
    credentialId?: string,
  ): Promise<void> {
    if (this.deps.baseAIClient.hasAdapter(provider)) {
      return;
    }

    if (!credentialId) {
      throw new Error(
        `No adapter registered for provider "${provider}" and no credentialId provided to create one.`,
      );
    }

    const { credentialsService, logger } = this.deps;
    if (!credentialsService) {
      throw new Error(
        'Credentials service not available — cannot resolve API key for adapter registration.',
      );
    }

    const credential = await credentialsService.getDecryptedWithRefresh(credentialId);
    const apiKey = (credential.config as Record<string, unknown>)?.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error(
        `Credential "${credentialId}" does not contain an apiKey — cannot register adapter.`,
      );
    }

    const detectedProvider = detectProviderFromCredential(credential) ?? provider;

    // Map BatchProvider enum to the string literal registerAdapter expects
    const providerLabel =
      detectedProvider === BatchProvider.OPENAI
        ? 'OPENAI'
        : detectedProvider === BatchProvider.ANTHROPIC
          ? 'ANTHROPIC'
          : detectedProvider === BatchProvider.OPENROUTER
            ? 'OPENROUTER'
            : (detectedProvider as 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER');

    logger.debug('Auto-registering adapter from credential', {
      provider: providerLabel,
      credentialId,
    });

    this.deps.baseAIClient.registerAdapter(providerLabel, apiKey);
  }

  /**
   * Build the node-keyed incoming data object for template resolution.
   * This aggregates outputs from all source nodes connected to the target node.
   *
   * Structure:
   * {
   *   "source_node_slug": <output>,        // direct parent outputs (top-level)
   *   "previous_nodes": {                   // indirect ancestor outputs (collapsed in UI)
   *     "ancestor_slug": <output>,
   *     ...
   *   }
   * }
   *
   * Input data structure matches the execution-process.md documentation:
   * - Keys: upstream node reference_id (or slug from label), normalized to snake_case
   * - Values: direct output value (the node's primary output, JSON-parsed if valid)
   *
   * Example: { "fetch_user": { "id": 123 }, "previous_nodes": { "init": "ok" } }
   *
   * Template usage:
   * - {{ fetch_user }} renders the full output object/value
   * - {{ fetch_user.id }} accesses nested properties directly
   * - {{ previous_nodes.init }} accesses indirect ancestor output
   */
  buildIncomingDataObject(
    node: FlowNodeDefinitions,
    nodeOutputs: Map<FlowNodeDefinitions['id'], NodeOutput | undefined>,
    edges: readonly FlowEdge[],
    nodeMap: Map<string, FlowNodeDefinitions>,
  ): NodeIncomingDataObject {
    const incomingData: NodeIncomingDataObject = {};
    const incomingEdges = edges.filter((edge) => edge.target === node.id);
    const directParentIds = new Set(incomingEdges.map((e) => e.source));

    for (const edge of incomingEdges) {
      const sourceNode = nodeMap.get(edge.source);
      const sourceOutput = nodeOutputs.get(edge.source);

      if (!sourceNode) {
        continue;
      }

      const slug = this.getNodeSlug(sourceNode);
      const outputValue = this.extractNodeOutputValue(sourceOutput);
      incomingData[slug] = outputValue;
    }

    // Collect indirect ancestors (all transitive upstream nodes not directly connected)
    const indirectAncestors = this.collectIndirectAncestors(
      directParentIds,
      edges,
      nodeMap,
      nodeOutputs,
    );
    if (Object.keys(indirectAncestors).length > 0) {
      incomingData.previous_nodes = indirectAncestors;
    }

    this.deps.logger.debug('Built incoming data object', {
      nodeId: node.id,
      nodeType: node.type,
      incomingNodeCount: Object.keys(incomingData).length,
      incomingKeys: Object.keys(incomingData),
      previousNodeKeys: Object.keys(indirectAncestors),
    });

    return incomingData;
  }

  /** Extract the slug (referenceId or generated) for a node definition. */
  private getNodeSlug(sourceNode: FlowNodeDefinitions): string {
    const nodeLabel = sourceNode.label ?? '';
    const referenceId = sourceNode.referenceId ?? '';
    const nodeId = sourceNode.id;
    const nodeType = sourceNode.type;
    const label = nodeLabel || nodeType || nodeId;
    return referenceId || generateNodeSlug(label, nodeId);
  }

  /** Extract the primary output value from a node's output, JSON-parsing strings when valid. */
  private extractNodeOutputValue(sourceOutput: NodeOutput | undefined): unknown {
    let outputValue: unknown = null;
    const variables = sourceOutput?.data?.variables;

    if (variables && typeof variables === 'object') {
      const outputVar = (variables as Record<string, { value?: unknown }>).output;
      if (outputVar && typeof outputVar === 'object' && 'value' in outputVar) {
        outputValue = outputVar.value;
      } else if (outputVar !== undefined) {
        outputValue = outputVar;
      } else {
        const firstKey = Object.keys(variables)[0];
        if (firstKey) {
          const firstVar = (variables as Record<string, { value?: unknown }>)[firstKey];
          if (firstVar && typeof firstVar === 'object' && 'value' in firstVar) {
            outputValue = firstVar.value;
          } else {
            outputValue = firstVar;
          }
        }
      }
    }

    if (typeof outputValue === 'string') {
      try {
        const parsed = JSON.parse(outputValue);
        if (typeof parsed === 'object' && parsed !== null) {
          outputValue = parsed;
        }
      } catch {
        // Not valid JSON, keep as string
      }
    }

    return outputValue;
  }

  /**
   * BFS from direct parents to collect all transitive ancestors that are NOT
   * directly connected to the current node, along with their outputs.
   */
  private collectIndirectAncestors(
    directParentIds: Set<string>,
    edges: readonly FlowEdge[],
    nodeMap: Map<string, FlowNodeDefinitions>,
    nodeOutputs: Map<FlowNodeDefinitions['id'], NodeOutput | undefined>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const visited = new Set<string>();
    const queue = [...directParentIds];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) {
        break;
      }
      const parentEdges = edges.filter((e) => e.target === currentId);
      for (const pe of parentEdges) {
        if (visited.has(pe.source) || directParentIds.has(pe.source)) {
          continue;
        }
        visited.add(pe.source);
        queue.push(pe.source);

        const ancestorNode = nodeMap.get(pe.source);
        if (!ancestorNode) {
          continue;
        }
        const slug = this.getNodeSlug(ancestorNode);
        const output = this.extractNodeOutputValue(nodeOutputs.get(pe.source));
        result[slug] = output;
      }
    }

    return result;
  }

  /**
   * Resolve {{ expression }} templates in node params using the incoming data context.
   * Returns the params with all templatable string values resolved.
   *
   * @param params - Node parameters to resolve
   * @param incomingData - Context data keyed by source node reference IDs
   * @param skipKeys - Param keys to skip (their values should not be resolved as templates)
   */
  async resolveTemplateParams(
    params: Record<string, unknown>,
    incomingData: NodeIncomingDataObject,
    skipKeys: string[] = [],
  ): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      // Skip keys that shouldn't have their templates resolved
      if (skipKeys.includes(key)) {
        resolved[key] = value;
        continue;
      }

      if (typeof value === 'string' && this.templateService.isTemplate(value)) {
        try {
          const renderedValue = await this.templateService.render(value, incomingData);
          resolved[key] = renderedValue;
          this.deps.logger.debug('Resolved template param', {
            param: key,
            template: value,
            resolved: renderedValue,
          });
        } catch (error) {
          // On error, keep original value and log warning
          this.deps.logger.warn('Failed to resolve template param', {
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

  prepareNodeInputs(
    node: FlowNodeDefinitions,
    nodeOutputs: Map<FlowNodeDefinitions['id'], NodeOutput | undefined>,
    edges: readonly FlowEdge[],
    nodeMap?: Map<string, FlowNodeDefinitions>,
  ): Record<string, unknown> {
    const nodeInputs: Record<string, unknown> = {};
    const missingInputs: string[] = [];
    const handleValidationErrors: string[] = [];

    const incomingEdges = edges.filter((edge) => edge.target === node.id);

    for (const edge of incomingEdges) {
      const sourceNodeOutput = nodeOutputs.get(edge.source);
      const sourceNode = nodeMap?.get(edge.source);

      if (sourceNode) {
        const validation = this.validateEdgeHandles(edge, sourceNode, node);
        if (!validation.isValid) {
          handleValidationErrors.push(...validation.errors);
        }
      }

      if (sourceNodeOutput) {
        const targetInputKey = edge.targetHandle || 'input';
        const sourceOutputKey = edge.sourceHandle || 'output';

        const outputValue = this.getOutputValue(
          sourceNodeOutput,
          sourceOutputKey,
          sourceNode?.type,
          edge.source,
        );

        if (outputValue !== undefined) {
          nodeInputs[targetInputKey] = outputValue;
        } else {
          missingInputs.push(`${edge.source}:${sourceOutputKey} -> ${targetInputKey}`);
        }
      } else {
        missingInputs.push(
          `${edge.source} (no output available) -> ${edge.targetHandle || 'input'}`,
        );
      }
    }

    if (handleValidationErrors.length > 0) {
      this.deps.logger.error('Edge handle validation errors detected', {
        nodeId: node.id,
        nodeType: node.type,
        errors: handleValidationErrors,
      });
    }

    if (missingInputs.length > 0) {
      this.deps.logger.warn('Node has missing inputs', {
        nodeId: node.id,
        nodeType: node.type,
        missingInputs,
        availableInputs: Object.keys(nodeInputs),
      });
    }

    this.deps.logger.debug('Prepared node inputs', {
      nodeId: node.id,
      nodeType: node.type,
      incomingEdgeCount: incomingEdges.length,
      inputKeys: Object.keys(nodeInputs),
      inputs: nodeInputs,
      missingInputCount: missingInputs.length,
      handleValidationErrorCount: handleValidationErrors.length,
    });

    return nodeInputs;
  }

  async executeNode(
    flowRunId: string,
    node: FlowNodeDefinitions,
    inputs: Record<string, unknown>,
    flowInputs: Record<string, unknown> = {},
    definition?: InvectDefinition,
    skippedNodeIds?: Set<string>,
    useBatchProcessing?: boolean,
    incomingData?: NodeIncomingDataObject,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecution> {
    const { logger } = this.deps;

    logger.debug('Executing node', { flowRunId: flowRunId, nodeId: node.id, nodeType: node.type });

    // ── Step 1: Check for mapper configuration (new system) ──────────
    const mapperConfig = node.mapper;
    if (mapperConfig?.enabled && mapperConfig?.expression && this.deps.jsExpressionService) {
      logger.debug('Node has mapper configuration, evaluating mapper expression', {
        flowRunId,
        nodeId: node.id,
        mode: mapperConfig.mode,
      });
      return this.executeNodeWithMapper(
        flowRunId,
        node,
        inputs,
        flowInputs,
        definition,
        skippedNodeIds,
        useBatchProcessing,
        incomingData ?? {},
        mapperConfig,
        abortSignal,
      );
    }

    // Standard single execution
    return this.executeNodeOnce(
      flowRunId,
      node,
      inputs,
      flowInputs,
      definition,
      skippedNodeIds,
      useBatchProcessing,
      incomingData,
      abortSignal,
    );
  }

  /**
   * Execute a node once (standard execution without looping).
   */
  private async executeNodeOnce(
    flowRunId: string,
    node: FlowNodeDefinitions,
    inputs: Record<string, unknown>,
    flowInputs: Record<string, unknown> = {},
    definition?: InvectDefinition,
    skippedNodeIds?: Set<string>,
    useBatchProcessing?: boolean,
    incomingData?: NodeIncomingDataObject,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecution> {
    const {
      logger,
      nodeExecutionService,
      nodeDataService: _nodeDataService,
      graphService,
      credentialsService,
    } = this.deps;

    const safeInputs = inputs || {};

    const actionRegistry = getGlobalActionRegistry();
    const action = actionRegistry.get(node.type);

    if (!action) {
      throw new Error(`No action found for node type: ${node.type}`);
    }

    const defaultParams: Record<string, unknown> = Object.fromEntries(
      (action.params.fields ?? [])
        .filter((f) => f.defaultValue !== undefined)
        .map((f) => [f.name, f.defaultValue]),
    );
    const nodeParams = { ...defaultParams, ...((node.params ?? {}) as Record<string, unknown>) };

    // Determine which params should NOT be pre-resolved as templates
    // For Template String node, the 'template' param is the actual template content
    // that the executor will process - it should not be pre-resolved
    const skipTemplateResolutionKeys: string[] = [];
    const nodeTypeStr = node.type as string;
    if (nodeTypeStr === 'core.template_string') {
      skipTemplateResolutionKeys.push('template');
    }

    // Resolve templates in node params using incoming data (keyed by source node reference IDs)
    // Templates should use {{ source_node_ref }} format to access upstream node outputs
    const resolvedParams = incomingData
      ? await this.resolveTemplateParams(nodeParams, incomingData, skipTemplateResolutionKeys)
      : nodeParams;

    logger.debug('Resolved node params', {
      nodeId: node.id,
      nodeType: node.type,
      defaultParamKeys: Object.keys(defaultParams),
      nodeParamKeys: Object.keys(node.params ?? {}),
      resolvedParamKeys: Object.keys(resolvedParams),
      skippedKeys: skipTemplateResolutionKeys,
    });

    // Store incomingData in the trace (uses reference_id-based keys like "user_data")
    // This matches what users see in the config panel and use in templates
    // Fall back to safeInputs only if incomingData is not available
    const traceInputs =
      incomingData && Object.keys(incomingData).length > 0
        ? (incomingData as Record<string, unknown>)
        : safeInputs;

    const trace = await nodeExecutionService.createNodeExecution(
      flowRunId,
      node.id,
      node.type,
      traceInputs,
    );

    try {
      await nodeExecutionService.updateNodeExecutionStatus(trace.id, NodeExecutionStatus.RUNNING);

      const executionContext: NodeExecutionContext = {
        nodeId: node.id,
        flowRunId: flowRunId,
        logger,
        globalConfig: {},
        flowInputs,
        functions: {
          evaluator: this.deps.jsExpressionService,
          markDownstreamNodesAsSkipped: (
            nodeId: string,
            edges: readonly FlowEdge[],
            skippedNodes: Set<string>,
            isFromIfElse?: boolean,
          ) => {
            logger.debug('Marking downstream nodes as skipped', {
              nodeId,
              edges: edges.length,
              skippedNodes: Array.from(skippedNodes),
              isFromIfElse,
            });

            graphService.markDownstreamNodesAsSkipped(nodeId, edges, skippedNodes, isFromIfElse);
          },
          runTemplateReplacement: async (template: string, variables: Record<string, unknown>) => {
            const result = await this.templateService.render(template, variables);
            if (result === null || result === undefined) {
              return '';
            }
            if (typeof result === 'object') {
              return JSON.stringify(result);
            }
            return String(result);
          },
          getCredential: async (credentialId: string) => {
            if (!credentialsService) {
              logger.warn('Credentials service not available', { credentialId });
              return null;
            }
            // Let errors (including OAuth2 refresh failures) propagate so the
            // caller receives a meaningful message instead of a generic
            // "No valid access token" error.
            const credential = await credentialsService.getDecryptedWithRefresh(credentialId);
            return credential;
          },
          submitPrompt: async (request) => {
            logger.debug('Submitting model prompt', {
              model: request.model,
              provider: request.provider,
              useBatchProcessing: request.useBatchProcessing,
            });
            await this.ensureAdapterRegistered(request.provider, request.credentialId);
            return this.deps.baseAIClient.executePrompt(request);
          },
          submitAgentPrompt: async (request) => {
            logger.debug('Submitting agent prompt', {
              model: request.model,
              toolCount: request.tools.length,
              messageCount: request.messages.length,
            });
            await this.ensureAdapterRegistered(request.provider, request.credentialId);
            return this.deps.baseAIClient.runAgentPrompt(request, request.provider);
          },
          recordToolExecution: async (input) => {
            const toolService = this.deps.nodeExecutionServiceForTools;
            if (!toolService) {
              logger.warn('Node execution service not available for tool recording');
              return null;
            }
            try {
              const record = await toolService.recordToolExecution(input);
              return { id: record.id };
            } catch (error) {
              logger.error('Failed to record tool execution', {
                toolId: input.toolId,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            }
          },
          incrementRetryCount: async (traceId: string) => {
            try {
              await nodeExecutionService.incrementRetryCount(traceId);
            } catch (error) {
              logger.debug('Failed to increment retry count (non-fatal)', {
                traceId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
        nodes: definition?.nodes || [],
        edges: definition?.edges || [],
        nodeExecutionResults: new Map(),
        allNodeOutputs: new Map(),
        allNodeInputs: new Map(),
        skippedNodeIds: skippedNodeIds || new Set(),
        startedAt: new Date(),
        flowId: '',
        flowVersion: 1,
        flowParams: {
          useBatchProcessing: useBatchProcessing ?? true,
        },
        // Incoming data from upstream nodes, keyed by reference ID
        // Available for nodes that do their own template processing
        incomingData: incomingData || {},
        // Per-run abort signal — fires when the user cancels the run (see
        // FlowRunCoordinator.abortRun). Actions propagate this into SDK calls.
        abortSignal,
      };

      // ── Plugin hook: beforeNodeExecute ───────────────────────────────────
      let hookResolvedParams = resolvedParams;
      if (this.deps.pluginHookRunner) {
        try {
          const beforeResult = await this.deps.pluginHookRunner.runBeforeNodeExecute({
            flowRun: {
              flowId: executionContext.flowId || '',
              flowRunId: flowRunId,
              flowVersion: executionContext.flowVersion || 1,
              inputs: flowInputs,
            },
            nodeId: node.id,
            nodeType: node.type,
            nodeLabel: node.label,
            inputs: traceInputs,
            params: hookResolvedParams,
          });

          if (beforeResult.skipped) {
            logger.info('Node execution skipped by plugin hook', { flowRunId, nodeId: node.id });
            return await nodeExecutionService.updateNodeExecutionStatus(
              trace.id,
              NodeExecutionStatus.SKIPPED,
            );
          }

          if (beforeResult.params) {
            hookResolvedParams = beforeResult.params;
          }
        } catch (hookError) {
          logger.warn('beforeNodeExecute plugin hook error (non-fatal)', {
            nodeId: node.id,
            error: hookError instanceof Error ? hookError.message : String(hookError),
          });
        }
      }

      // ── Dispatch: action execution ───────────────────────────────────────
      const dispatchStartTime = Date.now();
      const executionResult: import('src/types/node-execution.types').NodeExecutionResult =
        await executeActionAsNode(action, hookResolvedParams, executionContext);

      const dispatchDuration = Date.now() - dispatchStartTime;

      // ── Plugin hook: afterNodeExecute ────────────────────────────────────
      // Extract output only from success results (the union doesn't have .output on all variants)
      const rawOutput =
        executionResult.state === NodeExecutionStatus.SUCCESS ? executionResult.output : undefined;
      let finalOutput = rawOutput;
      if (this.deps.pluginHookRunner && executionResult.state !== NodeExecutionStatus.PENDING) {
        try {
          const afterResult = await this.deps.pluginHookRunner.runAfterNodeExecute({
            flowRun: {
              flowId: executionContext.flowId || '',
              flowRunId: flowRunId,
              flowVersion: executionContext.flowVersion || 1,
              inputs: flowInputs,
            },
            nodeId: node.id,
            nodeType: node.type,
            nodeLabel: node.label,
            inputs: traceInputs,
            params: hookResolvedParams,
            status: executionResult.state === NodeExecutionStatus.FAILED ? 'FAILED' : 'SUCCESS',
            output: rawOutput,
            error:
              executionResult.state === NodeExecutionStatus.FAILED
                ? executionResult.errors.join(', ')
                : undefined,
            errorDetails:
              executionResult.state === NodeExecutionStatus.FAILED
                ? executionResult.errorDetails
                : undefined,
            duration: dispatchDuration,
          });

          if (afterResult.output !== undefined) {
            finalOutput = afterResult.output as typeof finalOutput;
          }
        } catch (hookError) {
          logger.warn('afterNodeExecute plugin hook error (non-fatal)', {
            nodeId: node.id,
            error: hookError instanceof Error ? hookError.message : String(hookError),
          });
        }
      }

      if (executionResult.state === NodeExecutionStatus.FAILED) {
        const errorMessage = executionResult.errors.join(', ');
        logger.error('Node execution failed', {
          flowRunId: flowRunId,
          nodeId: node.id,
          error: errorMessage,
          errorCode: executionResult.errorDetails?.code,
        });

        return await nodeExecutionService.updateNodeExecutionStatus(
          trace.id,
          NodeExecutionStatus.FAILED,
          {
            error: errorMessage,
            errorDetails: executionResult.errorDetails,
            fieldErrors: executionResult.fieldErrors,
          },
        );
      } else if (executionResult.state === NodeExecutionStatus.PENDING) {
        logger.debug('Node submitted for batch processing', {
          flowRunId: flowRunId,
          nodeId: node.id,
          batchJobId: executionResult.batchJobId,
        });

        return await nodeExecutionService.updateNodeExecutionStatus(
          trace.id,
          NodeExecutionStatus.BATCH_SUBMITTED,
        );
      } else {
        logger.debug('Node execution completed successfully', {
          flowRunId: flowRunId,
          nodeId: node.id,
          outputKeys: Object.keys(finalOutput || {}),
        });

        return await nodeExecutionService.updateNodeExecutionStatus(
          trace.id,
          NodeExecutionStatus.SUCCESS,
          {
            outputs: finalOutput,
          },
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const details = classifyError(error);
      logger.error('Node execution failed', {
        flowRunId: flowRunId,
        nodeId: node.id,
        error: errorMessage,
        errorCode: details.code,
      });

      return await nodeExecutionService.updateNodeExecutionStatus(
        trace.id,
        NodeExecutionStatus.FAILED,
        {
          error: errorMessage,
          errorDetails: details,
        },
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATA MAPPER — NEW SYSTEM (replaces _loop)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a node with a data mapper.
   *
   * 1. Evaluate the mapper JS expression against upstream data
   * 2. If result is array + mode allows → iterate (execute once per item)
   * 3. If result is object → single execution with mapped data as context
   * 4. Primitives → single execution with { item: value } context
   */
  private async executeNodeWithMapper(
    flowRunId: string,
    node: FlowNodeDefinitions,
    inputs: Record<string, unknown>,
    flowInputs: Record<string, unknown>,
    definition: InvectDefinition | undefined,
    skippedNodeIds: Set<string> | undefined,
    useBatchProcessing: boolean | undefined,
    incomingData: NodeIncomingDataObject,
    mapperConfig: MapperConfig,
    _abortSignal?: AbortSignal,
  ): Promise<NodeExecution> {
    const { logger, nodeExecutionService } = this.deps;
    const jsService = this.deps.jsExpressionService;

    if (!jsService) {
      throw new Error('JS expression service is required for mapper execution.');
    }

    // ── Evaluate mapper expression ───────────────────────────────────
    let mappedResult: unknown;
    try {
      mappedResult = await jsService.evaluate(mapperConfig.expression, incomingData);
    } catch (e) {
      // Mapper expression failed — create a failed trace with the error
      const errorMessage = e instanceof Error ? e.message : `Mapper expression error: ${String(e)}`;
      logger.error('Mapper expression failed', {
        flowRunId,
        nodeId: node.id,
        expression: mapperConfig.expression,
        error: errorMessage,
      });

      const trace = await nodeExecutionService.createNodeExecution(flowRunId, node.id, node.type, {
        ...incomingData,
        _mapper: { expression: mapperConfig.expression, error: errorMessage },
      });
      return await nodeExecutionService.updateNodeExecutionStatus(
        trace.id,
        NodeExecutionStatus.FAILED,
        {
          error: errorMessage,
          errorDetails: {
            code: 'BAD_REQUEST',
            message: errorMessage,
            retryable: false,
          },
        },
      );
    }

    // ── Mode enforcement ─────────────────────────────────────────────
    const mode = mapperConfig.mode ?? 'auto';
    const isArray = Array.isArray(mappedResult);

    if (mode === 'iterate' && !isArray) {
      const errorMessage = `Mapper mode is "iterate" but expression returned ${typeof mappedResult}, not an array`;
      logger.error(errorMessage, { flowRunId, nodeId: node.id });
      const trace = await nodeExecutionService.createNodeExecution(flowRunId, node.id, node.type, {
        ...incomingData,
        _mapper: { expression: mapperConfig.expression, error: errorMessage },
      });
      return await nodeExecutionService.updateNodeExecutionStatus(
        trace.id,
        NodeExecutionStatus.FAILED,
        {
          error: errorMessage,
          errorDetails: { code: 'VALIDATION', message: errorMessage, retryable: false },
        },
      );
    }

    if (mode === 'reshape' && isArray) {
      // Reshape mode: wrap array in object to prevent accidental iteration
      mappedResult = { items: mappedResult };
    }

    const shouldIterate = mode === 'iterate' || (mode === 'auto' && isArray);

    // ── Branch: iterate vs single ────────────────────────────────────
    if (shouldIterate) {
      return this.executeNodeMapperIterating(
        flowRunId,
        node,
        inputs,
        flowInputs,
        definition,
        skippedNodeIds,
        useBatchProcessing,
        incomingData,
        mappedResult as unknown[],
        mapperConfig,
      );
    }

    // Single execution: mapper returned object or primitive
    let mappedData: NodeIncomingDataObject;
    if (mappedResult !== null && typeof mappedResult === 'object' && !isArray) {
      mappedData = mappedResult as NodeIncomingDataObject;
    } else {
      // Primitive — wrap in { item: value }
      mappedData = { item: mappedResult };
    }

    // Execute once with mapped data as context (replaces incomingData for template resolution)
    return this.executeNodeOnce(
      flowRunId,
      node,
      inputs,
      flowInputs,
      definition,
      skippedNodeIds,
      useBatchProcessing,
      mappedData,
    );
  }

  /**
   * Execute a node repeatedly — once per item from the mapper array result.
   * Handles concurrency, empty array behavior, and result packaging.
   */
  private async executeNodeMapperIterating(
    flowRunId: string,
    node: FlowNodeDefinitions,
    inputs: Record<string, unknown>,
    flowInputs: Record<string, unknown>,
    definition: InvectDefinition | undefined,
    skippedNodeIds: Set<string> | undefined,
    useBatchProcessing: boolean | undefined,
    incomingData: NodeIncomingDataObject,
    items: unknown[],
    mapperConfig: MapperConfig,
  ): Promise<NodeExecution> {
    const { logger, nodeExecutionService } = this.deps;

    // ── Handle empty array ───────────────────────────────────────────
    if (items.length === 0) {
      const trace = await nodeExecutionService.createNodeExecution(flowRunId, node.id, node.type, {
        ...incomingData,
        _mapper: { expression: mapperConfig.expression, itemCount: 0 },
      });

      if (mapperConfig.onEmpty === 'error') {
        return await nodeExecutionService.updateNodeExecutionStatus(
          trace.id,
          NodeExecutionStatus.FAILED,
          { error: 'Mapper returned empty array and onEmpty is "error"' },
        );
      }

      // Skip: return success with empty output
      return await nodeExecutionService.updateNodeExecutionStatus(
        trace.id,
        NodeExecutionStatus.SUCCESS,
        {
          outputs: {
            nodeType: node.type,
            data: {
              variables: {
                output: { value: [], type: 'object' as const },
              },
            },
          },
        },
      );
    }

    // ── Create parent trace ──────────────────────────────────────────
    const trace = await nodeExecutionService.createNodeExecution(flowRunId, node.id, node.type, {
      ...incomingData,
      _mapper: { expression: mapperConfig.expression, itemCount: items.length },
    });

    try {
      await nodeExecutionService.updateNodeExecutionStatus(trace.id, NodeExecutionStatus.RUNNING);

      const results: unknown[] = [];
      const concurrency = mapperConfig.concurrency ?? 1;
      let hasFailure = false;
      let failureError: unknown;

      if (concurrency === 1) {
        // Sequential — stop on first failure
        for (let i = 0; i < items.length; i++) {
          const itemContext = this.buildMapperItemContext(items[i], i, items.length, incomingData);
          const result = await this.executeSingleMapperIteration(
            flowRunId,
            node,
            inputs,
            flowInputs,
            definition,
            skippedNodeIds,
            useBatchProcessing,
            itemContext,
          );
          results.push(result);
        }
      } else {
        // Parallel with concurrency limit
        for (let start = 0; start < items.length; start += concurrency) {
          const batch = items.slice(start, start + concurrency);
          const batchResults = await Promise.allSettled(
            batch.map((item, batchIdx) => {
              const globalIdx = start + batchIdx;
              const itemContext = this.buildMapperItemContext(
                item,
                globalIdx,
                items.length,
                incomingData,
              );
              return this.executeSingleMapperIteration(
                flowRunId,
                node,
                inputs,
                flowInputs,
                definition,
                skippedNodeIds,
                useBatchProcessing,
                itemContext,
              );
            }),
          );

          for (const r of batchResults) {
            if (r.status === 'fulfilled') {
              results.push(r.value);
            } else {
              hasFailure = true;
              failureError = r.reason;
            }
          }
          if (hasFailure) {
            break;
          }
        }
      }

      if (hasFailure) {
        const errorMessage =
          failureError instanceof Error ? failureError.message : String(failureError);
        return await nodeExecutionService.updateNodeExecutionStatus(
          trace.id,
          NodeExecutionStatus.FAILED,
          { error: `Mapper iteration failed: ${errorMessage}` },
        );
      }

      // ── Package results ────────────────────────────────────────────
      const packagedOutput = this.packageMapperResults(results, mapperConfig);

      return await nodeExecutionService.updateNodeExecutionStatus(
        trace.id,
        NodeExecutionStatus.SUCCESS,
        {
          outputs: {
            nodeType: node.type,
            data: {
              variables: {
                output: { value: packagedOutput, type: 'object' as const },
              },
              metadata: {
                mapper: true,
                iterationCount: items.length,
                outputMode: mapperConfig.outputMode ?? 'array',
              },
            },
          },
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const details = classifyError(error);
      logger.error('Mapper iteration failed', { flowRunId, nodeId: node.id, error: errorMessage });
      return await nodeExecutionService.updateNodeExecutionStatus(
        trace.id,
        NodeExecutionStatus.FAILED,
        { error: errorMessage, errorDetails: details },
      );
    }
  }

  /**
   * Execute a single iteration within a mapper loop.
   * Returns the output value from the node execution.
   */
  private async executeSingleMapperIteration(
    flowRunId: string,
    node: FlowNodeDefinitions,
    inputs: Record<string, unknown>,
    flowInputs: Record<string, unknown>,
    definition: InvectDefinition | undefined,
    skippedNodeIds: Set<string> | undefined,
    useBatchProcessing: boolean | undefined,
    itemContext: NodeIncomingDataObject,
  ): Promise<unknown> {
    // Execute the node with the item context as incomingData
    // This means {{ }} expressions in config params resolve against the item
    const trace = await this.executeNodeOnce(
      flowRunId,
      node,
      inputs,
      flowInputs,
      definition,
      skippedNodeIds,
      useBatchProcessing,
      itemContext,
    );

    // Extract the output value from the trace
    const outputs = trace.outputs as NodeOutput | undefined;
    const outputVar = outputs?.data?.variables?.output;
    if (outputVar && typeof outputVar === 'object' && 'value' in outputVar) {
      return (outputVar as { value: unknown }).value;
    }
    return outputs?.data ?? null;
  }

  /**
   * Build the context object for a single iteration item.
   *
   * Layering (later wins on collision):
   * 1. incomingData — all upstream outputs preserved
   * 2. Item properties spread (if object) or { item: value } for primitives
   * 3. _item metadata (index, total, first/last)
   */
  private buildMapperItemContext(
    item: unknown,
    index: number,
    total: number,
    incomingData: NodeIncomingDataObject,
  ): NodeIncomingDataObject {
    const context: NodeIncomingDataObject = { ...incomingData };

    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      Object.assign(context, item);
    } else {
      context.item = item;
    }

    context._item = {
      value: item,
      index,
      iteration: index + 1,
      first: index === 0,
      last: index === total - 1,
      total,
    };

    return context;
  }

  /**
   * Package iteration results according to outputMode.
   */
  private packageMapperResults(results: unknown[], config: MapperConfig): unknown {
    const mode = config.outputMode ?? 'array';
    switch (mode) {
      case 'array':
        return results;
      case 'object': {
        const keyField = config.keyField ?? 'id';
        const obj: Record<string, unknown> = {};
        for (const r of results) {
          if (r && typeof r === 'object') {
            const key = String((r as Record<string, unknown>)[keyField] ?? '');
            if (key) {
              obj[key] = r;
            }
          }
        }
        return obj;
      }
      case 'first':
        return results[0] ?? null;
      case 'last':
        return results[results.length - 1] ?? null;
      case 'concat':
        return results.map((r) => String(r ?? '')).join('');
      default:
        return results;
    }
  }

  private validateEdgeHandles(
    _edge: FlowEdge,
    _sourceNode: FlowNodeDefinitions,
    _targetNode: FlowNodeDefinitions,
  ): { isValid: boolean; errors: string[] } {
    // Edge handle validation is disabled.
    // In the current architecture, nodes receive all upstream data via reference IDs,
    // and params contain {{ expression }} templates that reference that data.
    // The specific handle IDs on edges are informational only.
    return {
      isValid: true,
      errors: [],
    };
  }

  private getOutputValue(
    nodeOutput: NodeOutput,
    outputKey: string,
    sourceNodeType?: string,
    sourceNodeId?: string,
  ): unknown {
    if (!nodeOutput?.data?.variables) {
      this.deps.logger.debug('getOutputValue: Missing variables in nodeOutput', {
        outputKey,
        sourceNodeType,
        sourceNodeId,
      });
      return undefined;
    }

    const { variables } = nodeOutput.data;

    if (outputKey in variables) {
      const variable = variables[outputKey];
      this.deps.logger.debug('getOutputValue: Found variable', {
        outputKey,
        valueType: typeof variable.value,
        sourceNodeType,
        sourceNodeId,
      });
      return variable.value;
    }

    this.deps.logger.warn('getOutputValue: Variable not found', {
      outputKey,
      sourceNodeType,
      sourceNodeId,
      availableVariables: Object.keys(variables),
    });

    return undefined;
  }
}
