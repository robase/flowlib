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
import type { AgentProvider, PromptInput, ProviderToolDescriptor } from '../providers/types';
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

  // System-prompt composition (memoised) + progressive-disclosure skills.
  const skillSummaries = await loadSkillSummaries(deps, sessionId);
  const effectiveSystemPrompt = await composeEffectiveSystemPrompt(
    deps,
    sessionId,
    { systemPrompt: sessionRow.systemPrompt, denyList: sessionRow.denyList },
    skillSummaries,
  );
  const providerTools = buildProviderTools(deps, sessionId, skillSummaries.length > 0);

  // Provider rehydration — idempotent for providers that recognise the
  // existing providerSessionId; best-effort otherwise.
  try {
    await provider.createSession({
      auth,
      config: {},
      workspace: workspaceHandle as never,
      ensureWorkspace: ensureWorkspace as never,
      credentialId: sessionRow.credentialId ?? undefined,
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
    memory: [],
    attachments: [],
  });
  deps.promptCache.set(sessionId, prompt);
  return prompt;
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
  _sessionId: string,
  hasSkills: boolean,
): Record<string, ProviderToolDescriptor> {
  const tools: Record<string, ProviderToolDescriptor> = {};
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
  return tools;
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
