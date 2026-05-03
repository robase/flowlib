/**
 * Chat Stream Service
 *
 * The main entry point for the chat assistant feature.
 * Responsibilities:
 * - Resolve credential → determine provider (Anthropic/OpenAI) and API key
 * - Create ephemeral ProviderAdapter instances for chat requests
 * - Load flow context from the database
 * - Create ChatStreamSession instances
 *
 * Lifecycle: Singleton created during ServiceFactory.initialize().
 */

import type { Logger } from 'src/schemas';
import type { FlowlibIdentity } from 'src/types/auth.types';
import type { FlowlibInstance } from 'src/api/types';
import type { ActionRegistry } from '@flowlib/actions/registry';
import type { ProviderAdapter } from '../ai/provider-adapter';
import type {
  ChatMessage,
  ChatContext,
  ChatConfig,
  ChatStreamEvent,
  ResolvedChatConfig,
} from './chat-types';
import type { FlowContextData } from './system-prompt';
import { ChatConfigSchema } from './chat-types';
import { ChatToolkit } from './chat-toolkit';
import { ChatStreamSession } from './chat-stream-session';
import { ActiveChatSessions } from './active-chat-sessions';
import { OpenAIAdapter } from '../ai/openai-adapter';
import { AnthropicAdapter } from '../ai/anthropic-adapter';
import { OpenRouterAdapter } from '../ai/openrouter-adapter';
import { BatchProvider } from '../ai/ai-types';
import { detectProviderFromCredential } from 'src/utils/provider-detection';
import type { CredentialsService } from '../credentials/credentials.service';
import type { FlowsService } from '../flows/flows.service';
import type { FlowVersionsService } from '../flow-versions/flow-versions.service';

/**
 * Options for creating a chat stream.
 */
export interface CreateChatStreamOptions {
  messages: ChatMessage[];
  context: ChatContext;
  identity?: FlowlibIdentity;
}

/**
 * Chat Stream Service — manages chat sessions and dependencies.
 */
export class ChatStreamService {
  private toolkit: ChatToolkit;
  private chatConfig: ChatConfig;
  /**
   * In-process registry of in-flight chat turns. Decouples generation from
   * the HTTP request so client disconnects (page refresh) don't kill the
   * stream — the next client to subscribe replays buffered events and tails
   * live ones.
   */
  private readonly activeSessions: ActiveChatSessions;

  constructor(
    private readonly logger: Logger,
    private readonly credentialsService: CredentialsService,
    private readonly flowsService: FlowsService,
    private readonly flowVersionsService: FlowVersionsService,
    private readonly actionRegistry: ActionRegistry | null,
    /** Flowlib core instance — wired post-init via setFlowlibInstance() */
    private flowlib: FlowlibInstance | null,
  ) {
    // Parse and apply defaults to chat config
    this.chatConfig = ChatConfigSchema.parse({});
    this.toolkit = new ChatToolkit(logger);
    this.activeSessions = new ActiveChatSessions(logger);

    logger.info(
      `ChatStreamService initialized (enabled: ${this.chatConfig.enabled}, tools: ${this.toolkit.size})`,
    );
  }

  /**
   * Wire the FlowlibInstance reference post-construction.
   * Called by createFlowlib() after the instance is fully assembled,
   * breaking the circular dependency between ServiceFactory and FlowlibInstance.
   */
  setFlowlibInstance(instance: FlowlibInstance): void {
    this.flowlib = instance;
  }

  /**
   * Start a new chat turn and return a stream of its events.
   *
   * Generation runs in the background through the `ActiveChatSessions`
   * registry, which means the producer is independent of any single HTTP
   * request. The returned stream is a subscriber — dropping it (client
   * disconnect / page refresh) does NOT cancel the agent. A subsequent
   * reconnect via `subscribeToSession(sessionId)` replays buffered events
   * and tails the remaining ones.
   *
   * Yields a `session` event as the first frame so the client can persist
   * the id for reattachment.
   */
  async createStream(options: CreateChatStreamOptions): Promise<AsyncGenerator<ChatStreamEvent>> {
    if (!this.chatConfig.enabled) {
      return this.errorStream('Chat assistant is disabled in configuration');
    }

    const { messages, context, identity } = options;

    // 1. Resolve config (credential → provider + apiKey + model)
    let resolvedConfig: ResolvedChatConfig;
    try {
      resolvedConfig = await this.resolveConfig(context.credentialId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.errorStream(`Failed to resolve chat credentials: ${msg}`);
    }

    // 2. Create ephemeral adapter for this request
    const adapter = this.createAdapter(resolvedConfig);

    // 3. Load flow context from database (if flowId provided)
    let flowContext: FlowContextData | null = null;
    if (context.flowId) {
      try {
        flowContext = await this.loadFlowContext(
          context.flowId,
          context.selectedNodeId,
          context.viewMode,
          context.selectedRunId,
        );
      } catch (error: unknown) {
        this.logger.warn('Failed to load flow context for chat:', { error });
        // Continue without flow context — better than failing
      }
    }

    // 4. Apply per-request overrides from context
    if (context.maxSteps && context.maxSteps >= 1 && context.maxSteps <= 50) {
      resolvedConfig = { ...resolvedConfig, maxSteps: context.maxSteps };
    }
    if (context.model) {
      resolvedConfig = { ...resolvedConfig, model: context.model };
    }

    // 4b. Inject browser-local memory notes into flow context
    if (flowContext && context.memoryNotes) {
      const { flowNotes, workspaceNotes } = context.memoryNotes;
      if (flowNotes?.length || workspaceNotes?.length) {
        flowContext.memory = {
          flowNotes: flowNotes ?? [],
          workspaceNotes: workspaceNotes ?? [],
        };
      }
    }

    // 5. Register a session and kick off the agent loop in the background.
    const active = this.activeSessions.create({ flowId: context.flowId });
    // Seed the buffer with the session-id frame so even a reattach that
    // lands after the first push still sees it.
    this.activeSessions.push(active.id, {
      type: 'session',
      sessionId: active.id,
      flowId: context.flowId,
    });

    const session = new ChatStreamSession({
      logger: this.logger,
      toolkit: this.toolkit,
      config: resolvedConfig,
      adapter,
      identity,
      flowlib: this.flowlib as FlowlibInstance,
      actionRegistry: this.actionRegistry,
    });

    // Run the generator to completion independent of any subscriber.
    void this.runSessionToCompletion(active.id, session, messages, context, flowContext);

    // Return a subscriber stream — cancelling it does not abort the producer.
    return this.activeSessions.subscribe(active.id);
  }

  /**
   * Reattach to an in-flight session by id. Replays the full event buffer
   * then tails live events until the session completes. Safe to call from
   * multiple clients simultaneously.
   */
  subscribeToSession(sessionId: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    if (!this.activeSessions.get(sessionId)) {
      return this.errorStream(`Chat session ${sessionId} not found or expired`);
    }
    return this.activeSessions.subscribe(sessionId, signal);
  }

  /** True if there's an in-flight session with the given id. */
  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.get(sessionId) !== null;
  }

  /**
   * Run a single chat-session eviction tick — drops sessions that have
   * either exceeded the lifetime cap or sat idle past the reconnect grace.
   * Exposed for hosts that drive eviction from an external scheduler
   * (e.g. serverless runtimes that can't keep `setTimeout` alive between
   * invocations). Returns the number of sessions evicted.
   */
  evictExpiredSessions(now?: number): { count: number } {
    return this.activeSessions.evictExpiredSessions(now);
  }

  /**
   * Drive the underlying ChatStreamSession generator, forwarding each event
   * into the registry's event buffer and broadcasting to any current
   * subscribers. Runs independently of the HTTP request that kicked it off.
   */
  private async runSessionToCompletion(
    sessionId: string,
    session: ChatStreamSession,
    messages: ChatMessage[],
    context: ChatContext,
    flowContext: FlowContextData | null,
  ): Promise<void> {
    try {
      for await (const event of session.stream(messages, context, flowContext)) {
        this.activeSessions.push(sessionId, event);
      }
      this.activeSessions.close(sessionId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Background chat session failed', { sessionId, error: msg });
      this.activeSessions.push(sessionId, {
        type: 'error',
        message: `LLM call failed: ${msg}`,
        recoverable: false,
      });
      this.activeSessions.close(sessionId, msg);
    }
  }

  /** Called by FlowlibInstance.shutdown() — release any pending sessions. */
  shutdown(): void {
    this.activeSessions.shutdown();
  }

  /**
   * Check if the chat feature is enabled and properly configured.
   */
  isEnabled(): boolean {
    return this.chatConfig.enabled;
  }

  /**
   * Get the toolkit for external registration of tools.
   */
  getToolkit(): ChatToolkit {
    return this.toolkit;
  }

  // =====================================
  // CREDENTIAL & CONFIG RESOLUTION
  // =====================================

  /**
   * Resolve chat model configuration.
   *
   * Resolution order:
   * 1. Per-request credentialId (from frontend)
   * 2. chatConfig.credentialId (from FlowlibConfig)
   */
  private async resolveConfig(perRequestCredentialId?: string): Promise<ResolvedChatConfig> {
    const base: Partial<ResolvedChatConfig> = {
      maxSteps: this.chatConfig.maxSteps,
      maxHistoryMessages: this.chatConfig.maxHistoryMessages,
      enabled: this.chatConfig.enabled,
    };

    // Try per-request credential
    if (perRequestCredentialId) {
      return this.resolveFromCredential(perRequestCredentialId, base);
    }

    // Try chatConfig credential
    if (this.chatConfig.credentialId) {
      return this.resolveFromCredential(this.chatConfig.credentialId, base);
    }

    throw new Error(
      'No chat credential configured. Select a credential in the chat settings, ' +
        'or set chat.credentialId in the server config.',
    );
  }

  /**
   * Resolve config from a credential in the credentials table.
   */
  private async resolveFromCredential(
    credentialId: string,
    base: Partial<ResolvedChatConfig>,
  ): Promise<ResolvedChatConfig> {
    const credential = await this.credentialsService.getDecryptedWithRefresh(credentialId);

    const provider = detectProviderFromCredential(credential);
    if (!provider) {
      throw new Error(
        `Cannot determine AI provider from credential "${credentialId}". ` +
          `Set "provider" in credential metadata (OPENAI, ANTHROPIC, or OPENROUTER).`,
      );
    }

    const apiKey = (credential.config as Record<string, unknown>)?.apiKey as string;
    if (!apiKey) {
      throw new Error(`Credential "${credentialId}" has no apiKey in config.`);
    }

    const model = this.chatConfig.defaultModel ?? this.getDefaultModel(provider);

    const providerMap: Record<string, 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'> = {
      [BatchProvider.OPENAI]: 'OPENAI',
      [BatchProvider.ANTHROPIC]: 'ANTHROPIC',
      [BatchProvider.OPENROUTER]: 'OPENROUTER',
    };

    return {
      ...base,
      credentialId,
      model,
      provider: providerMap[provider] ?? 'OPENAI',
      apiKey,
      maxSteps: base.maxSteps ?? 15,
      maxHistoryMessages: base.maxHistoryMessages ?? 20,
      enabled: base.enabled ?? true,
    };
  }

  /**
   * Get the default model for a provider (cheap models for chat).
   */
  private getDefaultModel(provider: BatchProvider): string {
    switch (provider) {
      case BatchProvider.ANTHROPIC:
        return 'claude-sonnet-4-20250514';
      case BatchProvider.OPENAI:
        return 'gpt-4o-mini';
      case BatchProvider.OPENROUTER:
        return 'anthropic/claude-sonnet-4-20250514';
      default:
        return 'gpt-4o-mini';
    }
  }

  // =====================================
  // ADAPTER CREATION
  // =====================================

  /**
   * List available models for a given credential.
   * Creates an ephemeral adapter and calls listModels().
   */
  async listModels(
    credentialId: string,
    query?: string,
  ): Promise<{ id: string; name?: string; provider?: string }[]> {
    const resolvedConfig = await this.resolveFromCredential(credentialId, {});
    const adapter = this.createAdapter(resolvedConfig);
    const models = await adapter.listModels();
    let result = models.map((m) => ({ id: m.id, name: m.name, provider: m.provider }));
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (m) => m.id.toLowerCase().includes(q) || (m.name?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }

  /**
   * Create an ephemeral ProviderAdapter for a chat request.
   * Uses the resolved config to instantiate the correct adapter.
   */
  private createAdapter(config: ResolvedChatConfig): ProviderAdapter {
    switch (config.provider) {
      case 'OPENAI':
        return new OpenAIAdapter(this.logger, config.apiKey);
      case 'ANTHROPIC':
        return new AnthropicAdapter(this.logger, config.apiKey);
      case 'OPENROUTER':
        return new OpenRouterAdapter(this.logger, config.apiKey);
      default:
        throw new Error(`Unsupported chat provider: ${config.provider}`);
    }
  }

  // =====================================
  // FLOW CONTEXT LOADING
  // =====================================

  /**
   * Load flow context from the database for the system prompt.
   */
  private async loadFlowContext(
    flowId: string,
    selectedNodeId?: string,
    viewMode?: string,
    selectedRunId?: string,
  ): Promise<FlowContextData | null> {
    try {
      const flow = await this.flowsService.getFlowById(flowId);
      if (!flow) {
        return null;
      }

      // Get the latest version to read node definitions
      const latestVersion = await this.flowVersionsService.getFlowVersion(flowId, 'latest');
      if (!latestVersion) {
        return {
          flowId: flow.id,
          flowName: flow.name,
          flowDescription: flow.description ?? undefined,
          nodes: [],
          edges: [],
          selectedNodeId,
          viewMode: viewMode as 'edit' | 'runs' | undefined,
        };
      }

      // Parse definition
      const definition =
        typeof latestVersion.flowlibDefinition === 'string'
          ? JSON.parse(latestVersion.flowlibDefinition)
          : latestVersion.flowlibDefinition;

      interface FlowNode {
        id: string;
        type: string;
        label?: string;
        referenceId?: string;
        params?: Record<string, unknown>;
        data?: { label?: string; referenceId?: string; params?: Record<string, unknown> };
      }
      interface FlowEdge {
        source?: string;
        sourceId?: string;
        target?: string;
        targetId?: string;
      }

      const nodes = ((definition?.nodes ?? []) as FlowNode[]).map((n) => {
        const id = n.id;
        const type = n.type;
        const label = n.label || n.data?.label || 'Unnamed';
        const referenceId = n.referenceId || n.data?.referenceId;
        const isSelected = id === selectedNodeId;

        // For the selected node, include full params + mapper so the LLM can
        // inspect it without an extra get_current_flow_context call
        if (isSelected) {
          return {
            id,
            type,
            label,
            referenceId,
            params: n.params ?? n.data?.params,
            mapper: ((n as unknown as Record<string, unknown>).mapper ??
              (n.data as unknown as Record<string, unknown> | undefined)?.mapper) as
              | Record<string, unknown>
              | undefined,
          };
        }

        return {
          id,
          type,
          label,
          referenceId,
          paramKeys: n.params
            ? Object.keys(n.params)
            : n.data?.params
              ? Object.keys(n.data.params)
              : undefined,
        };
      });

      const edges = ((definition?.edges ?? []) as FlowEdge[]).map((e) => ({
        sourceId: e.source ?? e.sourceId ?? '',
        targetId: e.target ?? e.targetId ?? '',
      }));

      // Extract input fields from the manual trigger node (if any)
      const triggerNode = (definition?.nodes ?? []).find(
        (n: FlowNode) => n.type === 'trigger.manual',
      );
      const triggerParams = (triggerNode?.params ?? triggerNode?.data?.params) as
        | Record<string, unknown>
        | undefined;
      const declaredInputs = triggerParams?.inputs as
        | Array<{ name: string; type?: string; defaultValue?: unknown }>
        | undefined;
      const inputFields =
        Array.isArray(declaredInputs) && declaredInputs.length > 0
          ? declaredInputs.map((i) => ({ name: i.name, defaultValue: i.defaultValue }))
          : undefined;

      // When a run is selected (runs view), load its error context
      let runContext: FlowContextData['runContext'];
      if (selectedRunId && viewMode === 'runs' && this.flowlib) {
        try {
          const run = await this.flowlib.runs.get(selectedRunId);
          if (run) {
            const nodeExecsResult = await this.flowlib.runs.getNodeExecutions(selectedRunId);
            const failedNodes = nodeExecsResult.data
              .filter((ex) => ex.status === 'FAILED' || ex.error)
              .map((ex) => ({
                nodeId: ex.nodeId,
                nodeType: ex.nodeType,
                error: ex.error ?? 'Unknown error',
                input: ex.inputs
                  ? JSON.stringify(ex.inputs).length > 500
                    ? JSON.stringify(ex.inputs).slice(0, 500) + '…'
                    : ex.inputs
                  : undefined,
                output: ex.outputs
                  ? JSON.stringify(ex.outputs).length > 500
                    ? JSON.stringify(ex.outputs).slice(0, 500) + '…'
                    : ex.outputs
                  : undefined,
              }));

            runContext = {
              runId: run.id,
              status: run.status,
              error: run.error,
              failedNodes,
            };
          }
        } catch (error) {
          this.logger.warn('Failed to load run context for chat:', { error, selectedRunId });
        }
      }

      return {
        flowId: flow.id,
        flowName: flow.name,
        flowDescription: flow.description ?? undefined,
        nodes,
        edges,
        selectedNodeId,
        viewMode: viewMode as 'edit' | 'runs' | undefined,
        runContext,
        inputFields,
      };
    } catch (error) {
      this.logger.warn('Error loading flow context:', { error, flowId });
      return null;
    }
  }

  // =====================================
  // HELPERS
  // =====================================

  /**
   * Create a one-shot error stream.
   */
  private async *errorStream(message: string): AsyncGenerator<ChatStreamEvent> {
    yield { type: 'error', message, recoverable: false };
    yield { type: 'done' };
  }
}
