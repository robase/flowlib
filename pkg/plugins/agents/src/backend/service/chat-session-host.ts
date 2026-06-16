/**
 * `chat-session-host` — the runtime-agnostic chat host.
 *
 * This module owns everything needed to run one chat turn that used to
 * live inside the Cloudflare Durable Object (`AgentChatDO`): resolving
 * the session row + provider + workspace, composing the system prompt,
 * building the `PersistenceCallbacks`, assembling the `PromptInput`, and
 * driving `AgentService.runTurn`. The Durable Object and the Express SSE
 * endpoint both call into here — the only difference between them is the
 * injected `emit` sink and `abortSignal` (DO WebSocket vs. SSE writer).
 *
 * **No runtime-specific imports.** Everything the host needs (registries,
 * repositories, emit, logger, abort) is passed in via `ChatHostDeps`, so
 * this file is safe on the light `@flowlib/agents` entry — no
 * `cloudflare:workers`, no `this.env`, no `agents/ai-chat-agent`.
 */

import type { AgentEvent } from '../../shared/events';
import type { AgentsAuthContext } from '../../shared/auth-context';
import type {
  AgentService,
  DecisionGate,
  PersistenceCallbacks,
  SessionContext,
  SessionLogger,
} from './types';
import type {
  AgentCredentialsAccessor,
  AgentProvider,
  PromptInput,
  ProviderToolDescriptor,
} from '../providers/types';
import type { McpClientFactory } from '../mcp/client';
import { buildWebFetchTool } from '../tools/web-fetch';
import type { WorkspaceProvider } from '../workspaces/types';
import type { HookPipeline } from '../hooks/types';
import { noopHookPipeline } from '../hooks/types';
import type { PermissionsResolver } from '../permissions/types';
import { allowAllResolver } from '../permissions/types';
import { composeSystemPrompt } from '../prompt/compose';

// ─── Repositories surface ────────────────────────────────────────────

/**
 * The (structural) subset of the repositories bag the host reads. Both
 * the DO's loosely-typed bag and the endpoints' strongly-typed
 * `Repositories` (repositories/register.ts) satisfy this.
 */
export interface RepositoriesBag {
  sessions: {
    findById(id: string, orgId?: string | null): Promise<unknown>;
    update?(id: string, patch: { workspaceId?: string }, orgId?: string | null): Promise<unknown>;
  };
  workspaces?: {
    findById(id: string, orgId: string): Promise<unknown>;
    create?(input: {
      orgId: string | null;
      name: string;
      workspaceProviderId: string;
      createdBy: string;
      visibility?: string;
    }): Promise<unknown>;
  };
  messages?: { append?: (input: unknown) => Promise<void> };
  skills?: {
    listForScope(scope: {
      orgId: string | null;
      userId?: string;
      limit?: number;
    }): Promise<ReadonlyArray<{ name: string; description: string; body: string }>>;
    findByName(
      name: string,
      scope: { orgId: string | null; userId?: string },
    ): Promise<{ name: string; body: string } | null>;
  };
  memories?: {
    listForScope(scope: {
      orgId: string | null;
      userId?: string;
      limit?: number;
    }): Promise<ReadonlyArray<{ scope: string; content: string }>>;
    search(
      query: string,
      scope: { orgId: string | null; userId?: string; limit?: number },
    ): Promise<ReadonlyArray<{ id: string; scope: string; content: string }>>;
    create(input: {
      orgId: string | null;
      scope: 'personal' | 'project' | 'global';
      userId?: string | null;
      content: string;
      tags?: string[];
      createdBy: string;
    }): Promise<{ id: string; content: string }>;
  };
  mcpServers?: {
    findById(
      id: string,
      orgId?: string | null,
    ): Promise<{
      name: string;
      transport: 'stdio' | 'http' | 'sse';
      config: Record<string, unknown>;
    } | null>;
  };
  sessionPlans?: {
    get(
      sessionId: string,
      orgId?: string | null,
    ): Promise<{
      checkpoints: ReadonlyArray<{ id: string; label: string; status: string }>;
    } | null>;
    upsert(
      sessionId: string,
      orgId: string | null,
      checkpoints: ReadonlyArray<{ id?: string; label: string; status?: string }>,
    ): Promise<{ checkpoints: ReadonlyArray<{ id: string; label: string; status: string }> }>;
  };
}

// ─── Prompt cache ────────────────────────────────────────────────────

/**
 * Memoises the composed system prompt per session. `composeSystemPrompt`
 * is meant to run once at session start, but the host builds a context
 * every turn — so we cache the result. The DO supplies a per-instance
 * cache (recomputed on DO eviction); Express supplies a process-level one
 * (recomputed on restart). Either way a mid-session systemPrompt/denyList
 * edit takes effect on the next cold cache.
 */
export interface PromptCache {
  get(sessionId: string): string | undefined;
  set(sessionId: string, prompt: string): void;
}

/** Process/instance-level in-memory `PromptCache` backed by a `Map`. */
export function createInMemoryPromptCache(): PromptCache {
  const cache = new Map<string, string>();
  return {
    get: (sessionId) => cache.get(sessionId),
    set: (sessionId, prompt) => {
      cache.set(sessionId, prompt);
    },
  };
}

// ─── Host deps ───────────────────────────────────────────────────────

/** Everything the host needs to build a `SessionContext` for one turn. */
export interface ChatHostDeps {
  /** Stable session id (matches `agent_sessions.id`). */
  sessionId: string;
  /** Tenant org id. */
  orgId: string;
  /** Resolved auth context (sticky for the session). */
  auth: AgentsAuthContext;

  /** Provider registry (from the runtime). */
  providers: ReadonlyMap<string, AgentProvider>;
  /** Workspace provider registry (from the runtime). */
  workspaces?: ReadonlyMap<string, WorkspaceProvider>;
  /** Hook pipeline; defaults to the no-op pipeline. */
  hookPipeline?: HookPipeline;
  /** Permissions resolver; defaults to allow-all. */
  permissions?: PermissionsResolver;

  /** Materialised repositories bag. */
  repositories: RepositoriesBag;
  /**
   * Credentials accessor (`flowlib.credentials`) threaded to the provider
   * so it can resolve the chat's attached credential internally. Supplied
   * by the transport from `registries.credentials`.
   */
  credentials?: AgentCredentialsAccessor;

  /** Event sink — DO WebSocket broadcast or SSE writer. */
  emit: (event: AgentEvent) => void | Promise<void>;
  /** Logger. */
  logger: SessionLogger;
  /** Abort signal — the transport owns the source (disconnect / interrupt). */
  abortSignal: AbortSignal;

  /** Composed-prompt cache (per-instance for DO, per-process for Express). */
  promptCache: PromptCache;
  /** Optional human-in-the-loop gate (permission / human-input blocking). */
  decisionGate?: DecisionGate;
  /** Override the prompt composer (tests); defaults to `composeSystemPrompt`. */
  composeSystemPrompt?: typeof composeSystemPrompt;
  /**
   * Factory that connects to an external MCP server and returns a client.
   * When set (and the session has `enabledMcpServerIds`), each enabled
   * server's tools are loaded and exposed to the agent as provider tools.
   * Defaults to undefined (no MCP tools) — the transport wires the real
   * SDK-backed factory; tests inject a fake.
   */
  mcpClientFactory?: McpClientFactory;
}

/** A host error to surface to the client (the transport decides how). */
export interface ChatHostError {
  message: string;
  code: string;
}

// ─── Build the session context ───────────────────────────────────────

/**
 * Resolve everything for one turn and return a ready-to-run
 * `SessionContext`. Returns `{ error }` (rather than throwing or emitting)
 * when a required subsystem is missing, so the transport renders it its
 * own way (DO error envelope / SSE error frame).
 */
export async function buildSessionContext(
  deps: ChatHostDeps,
): Promise<{ context: SessionContext } | { error: ChatHostError }> {
  const { repositories, logger, orgId, sessionId, auth } = deps;

  const sessionRow = (await repositories.sessions.findById(sessionId)) as
    | {
        providerId: string;
        providerSessionId: string;
        orgId: string;
        workspaceId?: string;
        credentialId?: string | null;
        model?: string | null;
        systemPrompt?: string | null;
        denyList?: string[] | null;
        enabledTools?: string[] | null;
        enabledMcpServerIds?: string[] | null;
        permissionMode?: string | null;
      }
    | undefined;

  if (!sessionRow) {
    return { error: { message: `Session ${sessionId} not found`, code: 'SESSION_NOT_FOUND' } };
  }
  logger.debug('session row resolved', {
    sessionId,
    providerId: sessionRow.providerId,
    providerSessionId: sessionRow.providerSessionId,
    workspaceId: sessionRow.workspaceId,
    model: sessionRow.model,
  });

  if (sessionRow.orgId !== orgId) {
    // Defence-in-depth: never surface cross-tenant data even if a
    // session somehow moved orgs.
    return {
      error: { message: 'Session does not belong to this org.', code: 'CROSS_TENANT_DENIED' },
    };
  }

  const provider = deps.providers.get(sessionRow.providerId);
  if (!provider) {
    return {
      error: {
        message: `Provider ${sessionRow.providerId} not registered`,
        code: 'PROVIDER_NOT_FOUND',
      },
    };
  }

  const ensureWorkspace = makeEnsureWorkspace(deps, provider, sessionRow.workspaceId);

  // Eager-resolve only when the provider needs a workspace up front.
  let workspaceHandle: { metadata?: Record<string, unknown> } | undefined;
  if (provider.capabilities.workspaceRequired) {
    try {
      workspaceHandle = await ensureWorkspace();
    } catch (err) {
      logger.warn('eager workspace provisioning failed', {
        workspaceId: sessionRow.workspaceId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // System-prompt composition (memoised) + progressive-disclosure skills
  // + relevant memories.
  const skillSummaries = await loadSkillSummaries(deps, sessionId);
  const relevantMemories = await loadRelevantMemories(deps, sessionId);
  const sessionPlan = await loadSessionPlan(deps, sessionId);
  const effectiveSystemPrompt = await composeEffectiveSystemPrompt(
    deps,
    sessionId,
    { systemPrompt: sessionRow.systemPrompt, denyList: sessionRow.denyList },
    skillSummaries,
    relevantMemories,
    sessionPlan,
  );
  const providerTools = buildProviderTools(deps, sessionId, skillSummaries.length > 0);
  // Merge in tools from the session's enabled external MCP servers.
  const mcpTools = await loadMcpProviderTools(
    deps,
    sessionRow.enabledMcpServerIds ?? [],
    sessionId,
  );
  Object.assign(providerTools, mcpTools);

  // Provider rehydration — idempotent for providers that recognise the
  // existing providerSessionId; best-effort otherwise.
  try {
    await provider.createSession({
      auth,
      // Thread the chat's selected model so the provider session resolves
      // its credential against the right vendor. Without this the provider
      // falls back to its own default model (e.g. `anthropic/...`) and
      // credential resolution targets the wrong vendor.
      config: sessionRow.model ? { defaultModel: sessionRow.model } : {},
      workspace: workspaceHandle as never,
      ensureWorkspace: ensureWorkspace as never,
      credentialId: sessionRow.credentialId ?? undefined,
      credentials: deps.credentials,
      providerSessionId: sessionRow.providerSessionId,
      systemPrompt: effectiveSystemPrompt,
    } as never);
  } catch (err) {
    logger.warn('provider rehydrate failed', {
      providerId: sessionRow.providerId,
      providerSessionId: sessionRow.providerSessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    // Fall through — `prompt()` surfaces an unknown-session error the
    // kernel maps to a session-end-with-error event.
  }

  const context: SessionContext = {
    sessionId,
    providerSessionId: sessionRow.providerSessionId,
    auth,
    provider,
    workspace: workspaceHandle as never,
    hooks: deps.hookPipeline ?? noopHookPipeline,
    permissions: deps.permissions ?? allowAllResolver,
    logger,
    callbacks: buildPersistenceCallbacks(deps.repositories),
    emit: deps.emit,
    abortSignal: deps.abortSignal,
    defaultModel: sessionRow.model ?? undefined,
    ...(deps.decisionGate ? { decisionGate: deps.decisionGate } : {}),
    ...(sessionRow.denyList ? { denyList: sessionRow.denyList } : {}),
    ...(sessionRow.enabledTools ? { enabledTools: sessionRow.enabledTools } : {}),
    ...(Object.keys(providerTools).length > 0 ? { providerTools } : {}),
  };
  return { context };
}

// ─── Run one turn ────────────────────────────────────────────────────

/**
 * Build the context and drive one turn through `agentService.runTurn`.
 * Returns `{ error }` for build failures; otherwise the `RunResult`.
 */
export async function runChatTurn(
  deps: ChatHostDeps & { agentService: AgentService },
  promptText: string,
): Promise<{ result: Awaited<ReturnType<AgentService['runTurn']>> } | { error: ChatHostError }> {
  const built = await buildSessionContext(deps);
  if ('error' in built) {
    return built;
  }
  const ctx = built.context;
  const promptInput: PromptInput = {
    providerSessionId: ctx.providerSessionId,
    parts: [{ type: 'text', text: promptText }],
    abortSignal: ctx.abortSignal,
    model: ctx.defaultModel,
    ...(ctx.denyList ? { extraDenied: ctx.denyList } : {}),
    ...(ctx.enabledTools ? { enabledTools: ctx.enabledTools } : {}),
    ...(ctx.providerTools ? { providerTools: ctx.providerTools } : {}),
    ...(ctx.decisionGate ? { decisionGate: ctx.decisionGate } : {}),
  };
  const result = await deps.agentService.runTurn(ctx, promptInput);
  return { result };
}

// ─── Helpers (ported from the DO, parameterised) ─────────────────────

/**
 * Lazily provision-or-resolve the session's workspace handle, caching it
 * for the turn. Pillar A keeps the DO's resolve-only behaviour; Pillar D
 * (ComputeSDK) extends first-provision to call `wsProvider.create` so the
 * provider can capture its assigned sandbox id.
 */
function makeEnsureWorkspace(
  deps: ChatHostDeps,
  provider: AgentProvider,
  initialWorkspaceId: string | undefined,
): () => Promise<{ metadata?: Record<string, unknown> }> {
  let cached: { metadata?: Record<string, unknown> } | undefined;
  const { repositories, workspaces, logger, orgId, sessionId, auth } = deps;
  return async () => {
    if (cached) {
      return cached;
    }
    let workspaceId = initialWorkspaceId;
    let workspaceProviderId: string | undefined;
    if (workspaceId && repositories.workspaces) {
      const wsRow = (await repositories.workspaces.findById(workspaceId, orgId)) as
        | { workspaceProviderId?: string }
        | undefined;
      workspaceProviderId = wsRow?.workspaceProviderId;
    }
    if (!workspaceId) {
      workspaceProviderId =
        provider.capabilities.preferredWorkspaceProviderId ??
        (workspaces ? workspaces.keys().next().value : undefined);
      if (!workspaceProviderId) {
        throw new Error('No workspace provider registered to provision a sandbox.');
      }
      if (!repositories.workspaces?.create) {
        throw new Error('Workspaces repository unavailable — cannot provision a sandbox.');
      }
      const created = (await repositories.workspaces.create({
        orgId,
        name: 'Chat workspace',
        workspaceProviderId,
        createdBy: auth.userId,
        visibility: 'private',
      })) as { id: string };
      workspaceId = created.id;
      if (repositories.sessions.update) {
        await repositories.sessions.update(sessionId, { workspaceId }, orgId);
      }
      logger.debug('provisioned workspace on demand', {
        sessionId,
        workspaceId,
        workspaceProviderId,
      });
    }
    if (!workspaceProviderId) {
      throw new Error(`Workspace ${workspaceId} has no provider id on its row.`);
    }
    const wsProvider = workspaces?.get(workspaceProviderId);
    if (!wsProvider) {
      throw new Error(
        `Workspace provider "${workspaceProviderId}" not registered in this isolate.`,
      );
    }
    cached = (await wsProvider.resolve(workspaceId, auth)) as {
      metadata?: Record<string, unknown>;
    };
    return cached;
  };
}

/**
 * Compose the effective system prompt (memoised via `deps.promptCache`).
 */
async function composeEffectiveSystemPrompt(
  deps: ChatHostDeps,
  sessionId: string,
  row: { systemPrompt?: string | null; denyList?: string[] | null },
  skillSummaries: ReadonlyArray<{ name: string; description: string; body?: string }>,
  memory: ReadonlyArray<{ scope: string; content: string }>,
  plan: { checkpoints: ReadonlyArray<{ id: string; label: string; status: string }> } | undefined,
): Promise<string> {
  const cached = deps.promptCache.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }
  const compose = deps.composeSystemPrompt ?? composeSystemPrompt;
  const prompt = await compose({
    systemPrompt: row.systemPrompt ?? '',
    skillSummaries,
    denyList: row.denyList ?? [],
    availableTools: [],
    memory,
    ...(plan ? { plan } : {}),
    attachments: [],
  });
  deps.promptCache.set(sessionId, prompt);
  return prompt;
}

/**
 * Load the session's working plan (if any) for the "## Session plan" prompt
 * section. Best-effort — a missing repo or error yields no plan.
 */
async function loadSessionPlan(
  deps: ChatHostDeps,
  sessionId: string,
): Promise<
  { checkpoints: ReadonlyArray<{ id: string; label: string; status: string }> } | undefined
> {
  const repo = deps.repositories.sessionPlans;
  if (!repo) {
    return undefined;
  }
  try {
    const plan = await repo.get(sessionId, deps.orgId);
    return plan && plan.checkpoints.length > 0 ? { checkpoints: plan.checkpoints } : undefined;
  } catch (err) {
    deps.logger.warn('session-plan load failed — proceeding without it', {
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Load the memories visible to this session for the prompt's "Relevant
 * memories" section. Most-recent-first, capped. Best-effort — a missing
 * repo or a query error yields no memories (the `memory.search` tool
 * still gives the agent on-demand recall). Memoised indirectly via the
 * prompt cache, so this runs once per session lifetime.
 */
async function loadRelevantMemories(
  deps: ChatHostDeps,
  sessionId: string,
): Promise<ReadonlyArray<{ scope: string; content: string }>> {
  const memories = deps.repositories.memories;
  if (!memories) {
    return [];
  }
  const MAX_MEMORIES = 20;
  try {
    const all = await memories.listForScope({
      orgId: deps.orgId,
      userId: deps.auth.userId,
      limit: MAX_MEMORIES,
    });
    return all.map((m) => ({ scope: m.scope, content: m.content }));
  } catch (err) {
    deps.logger.warn('memory load failed — proceeding without memories', {
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Load the skills visible to this session as summaries (name +
 * description); bodies are fetched on demand via the `skills.read` tool.
 * Best-effort — a repository error yields no skills.
 */
async function loadSkillSummaries(
  deps: ChatHostDeps,
  sessionId: string,
): Promise<ReadonlyArray<{ name: string; description: string }>> {
  const skills = deps.repositories.skills;
  if (!skills) {
    return [];
  }
  const MAX_SKILLS = 30;
  try {
    const all = await skills.listForScope({
      orgId: deps.orgId,
      userId: deps.auth.userId,
      limit: MAX_SKILLS,
    });
    return all.map((s) => ({ name: s.name, description: s.description }));
  } catch (err) {
    deps.logger.warn('skill load failed — proceeding without skills', {
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Build the plugin-contributed tools — today just `skills.read`, injected
 * only when the session has visible skills so the prompt's
 * "fetchable via skills.read" promise has a backing tool.
 */
function buildProviderTools(
  deps: ChatHostDeps,
  sessionId: string,
  hasSkills: boolean,
): Record<string, ProviderToolDescriptor> {
  const tools: Record<string, ProviderToolDescriptor> = {};

  // Always-on: fetch public URLs (docs/issues/specs). SSRF-guarded; a
  // deployment can disable it per-session via the deny-list.
  tools['web.fetch'] = buildWebFetchTool();

  // Ask the user a clarifying question and block until they answer — wired
  // onto the decision gate + the human-input transport (DO WebSocket / SSE
  // control frame). Only offered when a gate is present.
  const gate = deps.decisionGate;
  if (gate) {
    tools['ask_user'] = {
      description:
        'Ask the user a clarifying question and wait for their reply. Use ' +
        'sparingly — only when you genuinely cannot proceed without a decision ' +
        'that is the user’s to make (ambiguous requirements, a risky/destructive ' +
        'action, missing information). Returns { answer }.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user.' },
        },
        required: ['question'],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (!question) {
          return { error: 'question is required.' };
        }
        const id = globalThis.crypto.randomUUID();
        options.abortSignal?.throwIfAborted?.();
        await deps.emit({ type: 'human-input-request', id, prompt: question, blocking: true });
        // Blocks until the transport calls gate.resolveHumanInput(id, …)
        // (or rejectAll on abort/disconnect).
        const answer = await gate.awaitHumanInput({ id, prompt: question });
        return { answer };
      },
    };
  }

  const skillsRepo = deps.repositories.skills;
  if (skillsRepo && hasSkills) {
    tools['skills.read'] = {
      description:
        'Read the full body of an available skill by name. Call this when a skill ' +
        'listed under "Available skills" applies to the task before you start.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The skill name, exactly as listed.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const name = typeof input.name === 'string' ? input.name : '';
        const skill = await skillsRepo.findByName(name, {
          orgId: deps.orgId,
          userId: deps.auth.userId,
        });
        if (!skill) {
          return { error: `No skill named "${name}" is available to this session.` };
        }
        return { name: skill.name, body: skill.body };
      },
    };
  }

  // Memory tools — available whenever the memories repo is wired. `search`
  // recalls relevant memories on demand; `write` persists a durable note.
  const memoriesRepo = deps.repositories.memories;
  if (memoriesRepo) {
    tools['memory.search'] = {
      description:
        'Search durable memories (facts the user told you, preferences, project ' +
        'context) by keyword. Call this when prior context would help answer.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to recall, in a few words.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = typeof input.query === 'string' ? input.query : '';
        const results = await memoriesRepo.search(query, {
          orgId: deps.orgId,
          userId: deps.auth.userId,
          limit: 5,
        });
        return { results: results.map((m) => ({ scope: m.scope, content: m.content })) };
      },
    };

    tools['memory.write'] = {
      description:
        'Save a durable memory so it is available in future sessions — a stable ' +
        'fact, preference, or decision worth remembering. Keep it concise.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact to remember, one sentence.' },
          scope: {
            type: 'string',
            enum: ['personal', 'global'],
            description: 'personal = just this user (default); global = the whole org.',
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const content = typeof input.content === 'string' ? input.content.trim() : '';
        if (!content) {
          return { error: 'content is required to write a memory.' };
        }
        const scope = input.scope === 'global' ? 'global' : 'personal';
        const created = await memoriesRepo.create({
          orgId: deps.orgId,
          scope,
          userId: scope === 'personal' ? deps.auth.userId : null,
          content,
          createdBy: deps.auth.userId,
        });
        return { id: created.id, saved: true };
      },
    };
  }

  // Working task list (TodoWrite-style). The agent keeps a checklist for
  // multi-step work; it's rendered back into the prompt each turn and shown
  // in the UI so progress is visible.
  const plansRepo = deps.repositories.sessionPlans;
  if (plansRepo) {
    tools['update_plan'] = {
      description:
        'Maintain your task list for this multi-step job. Pass the FULL list of ' +
        'steps each time (it replaces the previous list). Mark exactly one step ' +
        '"doing" as you work; flip to "done" when finished. Use for non-trivial ' +
        'tasks so progress stays visible — skip it for simple one-shot requests.',
      parameters: {
        type: 'object',
        properties: {
          checkpoints: {
            type: 'array',
            description: 'The full ordered list of steps.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short description of the step.' },
                status: {
                  type: 'string',
                  enum: ['todo', 'doing', 'done', 'blocked'],
                  description: 'Step status (default todo).',
                },
              },
              required: ['label'],
              additionalProperties: false,
            },
          },
        },
        required: ['checkpoints'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const rawList = Array.isArray(input.checkpoints) ? input.checkpoints : [];
        const checkpoints = rawList
          .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
          .map((c) => ({
            label: typeof c.label === 'string' ? c.label : '',
            status: typeof c.status === 'string' ? c.status : 'todo',
          }))
          .filter((c) => c.label.length > 0);
        const saved = await plansRepo.upsert(sessionId, deps.orgId, checkpoints);
        return { checkpoints: saved.checkpoints };
      },
    };
  }
  return tools;
}

/**
 * Connect the session's enabled MCP servers and expose their tools as
 * provider tools (`mcp.<server>.<tool>`). Best-effort per server — a
 * connection or list failure logs + skips that server rather than
 * failing the turn. Requires `deps.mcpClientFactory` (the transport
 * wires the real SDK-backed factory; absent → no MCP tools).
 */
async function loadMcpProviderTools(
  deps: ChatHostDeps,
  enabledIds: ReadonlyArray<string>,
  sessionId: string,
): Promise<Record<string, ProviderToolDescriptor>> {
  const out: Record<string, ProviderToolDescriptor> = {};
  const factory = deps.mcpClientFactory;
  const repo = deps.repositories.mcpServers;
  if (!factory || !repo || enabledIds.length === 0) {
    return out;
  }
  for (const id of enabledIds) {
    try {
      const server = await repo.findById(id, deps.orgId);
      if (!server) {
        deps.logger.warn('enabled MCP server not found — skipping', { sessionId, mcpServerId: id });
        continue;
      }
      const client = await factory({ transport: server.transport, config: server.config });
      const tools = await client.listTools();
      for (const tool of tools) {
        // Namespace by server so two servers exposing the same tool name
        // don't collide. The ai-sdk provider sanitises the dotted id for
        // the wire and restores it on emitted events.
        const key = `mcp.${server.name}.${tool.name}`;
        out[key] = {
          description: tool.description ?? `MCP tool "${tool.name}" from ${server.name}`,
          parameters:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? tool.inputSchema
              : { type: 'object', properties: {}, additionalProperties: true },
          execute: async (input) => client.callTool(tool.name, input),
        };
      }
    } catch (err) {
      deps.logger.warn('MCP server connect/list failed — skipping', {
        sessionId,
        mcpServerId: id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Build the `PersistenceCallbacks` the kernel calls. Delegates to the
 * repositories' `messages.append` when present; otherwise no-ops so the
 * host can run end-to-end during incremental wiring.
 */
export function buildPersistenceCallbacks(repositories: {
  messages?: { append?: (input: unknown) => Promise<void> };
}): PersistenceCallbacks {
  const append = repositories?.messages?.append;
  const noop = (): Promise<void> => Promise.resolve();
  if (!append) {
    return {
      onMessageStart: noop,
      onTextDelta: noop,
      onToolCall: noop,
      onToolResult: noop,
      onFileEdit: noop,
      onMessageComplete: noop,
      onTurnEnd: noop,
    };
  }
  return {
    onMessageStart: (input) => append({ kind: 'message-start', ...input }),
    onTextDelta: (input) => append({ kind: 'text-delta', ...input }),
    onToolCall: (input) => append({ kind: 'tool-call', ...input }),
    onToolResult: (input) => append({ kind: 'tool-result', ...input }),
    onFileEdit: (input) => append({ kind: 'file-edit', ...input }),
    onMessageComplete: (input) => append({ kind: 'message-complete', ...input }),
    onTurnEnd: (input) => append({ kind: 'turn-end', ...input }),
  };
}

/** Console-backed `SessionLogger` (default for the DO transport). */
/* eslint-disable no-console */
export function createConsoleSessionLogger(tag = '[agents]'): SessionLogger {
  return {
    debug: (message, meta) => console.debug(tag, message, meta ?? {}),
    info: (message, meta) => console.info(tag, message, meta ?? {}),
    warn: (message, meta) => console.warn(tag, message, meta ?? {}),
    error: (message, meta) => console.error(tag, message, meta ?? {}),
  };
}
/* eslint-enable no-console */

// ─── Decision gate ───────────────────────────────────────────────────

/**
 * In-memory `DecisionGate` — opens a pending promise per request id,
 * resolved when the transport delivers the matching control frame.
 * Shared by the DO (`onMessage`) and the Express control endpoint.
 */
export function createDecisionGate(): DecisionGate {
  type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  const permissions = new Map<string, Pending>();
  const humanInputs = new Map<string, Pending>();

  const await_ = (map: Map<string, Pending>, id: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      map.set(id, { resolve, reject });
    });

  const resolve_ = (map: Map<string, Pending>, id: string, value: unknown): void => {
    const pending = map.get(id);
    if (pending) {
      map.delete(id);
      pending.resolve(value);
    }
  };

  return {
    awaitPermission: (request) => await_(permissions, request.id),
    awaitHumanInput: (request) => await_(humanInputs, request.id),
    resolvePermission: (id, decision) => resolve_(permissions, id, decision),
    resolveHumanInput: (id, response) => resolve_(humanInputs, id, response),
    rejectAll: (reason) => {
      for (const map of [permissions, humanInputs]) {
        for (const [, pending] of map) {
          pending.reject(reason ?? new Error('decision gate closed'));
        }
        map.clear();
      }
    },
  };
}
