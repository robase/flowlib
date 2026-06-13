/**
 * Chat-stream endpoints — the Node/Express transport for the agent loop.
 *
 *   POST /agents/sessions/:id/stream   → SSE stream of AgentEvents
 *   POST /agents/sessions/:id/control  → interrupt / permission / HIL
 *
 * This is the non-Cloudflare counterpart to `AgentChatDO`: it drives the
 * same runtime-agnostic `runChatTurn` host, but `emit` writes Server-Sent
 * Events to a `ReadableStream` (which the Express bridge pipes to the
 * response) instead of broadcasting over a Durable Object WebSocket. The
 * wire envelopes are identical to the DO's (`flowlib.agent-event` /
 * `flowlib.agent-error`), so the frontend's `parseInboundFrame` handles
 * both transports unchanged.
 *
 * Because SSE is one-way, control frames (interrupt / permission /
 * human-input responses) arrive on the sibling `/control` POST and are
 * routed into the in-flight turn via a process-level session registry.
 *
 * **Single-process assumption.** The control POST must reach the same
 * Node instance that owns the stream (session affinity). Fine for
 * single-process dev (express-drizzle); multi-instance deployments need a
 * sticky session or a shared bus — documented, not solved here.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentService, DecisionGate } from '../service/types';
import type { AgentEvent } from '../../shared/events';
import {
  type ChatHostDeps,
  createConsoleSessionLogger,
  createDecisionGate,
  createInMemoryPromptCache,
  runChatTurn,
} from '../service/chat-session-host';
import { type EndpointDeps, badRequest, bodyString, safeHandler } from './helpers';
import { createDefaultMcpClientFactory, type McpClientFactory } from '../mcp/client';

/** Lazily-built singleton MCP client factory shared across stream requests. */
let _mcpFactory: McpClientFactory | undefined;
function mcpClientFactory(): McpClientFactory {
  return (_mcpFactory ??= createDefaultMcpClientFactory());
}

/** A live turn the control endpoint can reach. */
interface ActiveTurn {
  abort: () => void;
  gate: DecisionGate;
}

/**
 * Process-level registry of in-flight turns, keyed by session id. One
 * turn per session at a time (a new `/stream` replaces the previous).
 */
const activeTurns = new Map<string, ActiveTurn>();

/** Process-level composed-prompt cache (keyed by session id inside). */
const promptCache = createInMemoryPromptCache();

const encoder = new TextEncoder();
const sseFrame = (obj: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

/**
 * `POST /agents/sessions/:id/stream` — run one turn, streaming
 * AgentEvents back as SSE.
 */
async function streamSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const sessionId = deps.endpointCtx.params.id;
  if (!sessionId) {
    return badRequest('Missing session id');
  }
  const body = deps.endpointCtx.body as Record<string, unknown> | undefined;
  const promptText = extractPromptText(body);
  if (!promptText) {
    return badRequest('No prompt text — expected { text } or { messages: [...] }');
  }

  const registries = deps.pluginCtx.registries;
  const agentService = registries.agentService as AgentService | undefined;
  if (!agentService) {
    return badRequest('AgentService not registered', { code: 'AGENT_SERVICE_MISSING' });
  }

  const abortController = new AbortController();
  const gate = createDecisionGate();
  const logger = createConsoleSessionLogger('[agents:http]');

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const emit = (event: AgentEvent): void => {
    try {
      controllerRef?.enqueue(sseFrame({ type: 'flowlib.agent-event', event }));
    } catch {
      // Controller closed (client gone) — abort so the turn unwinds.
      abortController.abort();
    }
  };

  const hostDeps: ChatHostDeps & { agentService: AgentService } = {
    sessionId,
    orgId: deps.auth.orgId,
    auth: deps.auth,
    providers: registries.providers,
    workspaces: registries.workspaces,
    hookPipeline: (registries as { hookPipeline?: ChatHostDeps['hookPipeline'] }).hookPipeline,
    permissions: registries.permissions as ChatHostDeps['permissions'],
    credentials: registries.credentials as ChatHostDeps['credentials'],
    mcpClientFactory: mcpClientFactory(),
    repositories: deps.repos as unknown as ChatHostDeps['repositories'],
    emit,
    logger,
    abortSignal: abortController.signal,
    promptCache,
    decisionGate: gate,
    agentService,
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      // Replace any previous in-flight turn for this session.
      activeTurns.get(sessionId)?.abort();
      activeTurns.set(sessionId, { abort: () => abortController.abort(), gate });

      void (async () => {
        try {
          const outcome = await runChatTurn(hostDeps, promptText);
          if ('error' in outcome) {
            controller.enqueue(sseFrame({ type: 'flowlib.agent-error', error: outcome.error }));
          }
        } catch (err) {
          controller.enqueue(
            sseFrame({
              type: 'flowlib.agent-error',
              error: {
                message: err instanceof Error ? err.message : String(err),
                code: 'RUN_TURN_FAILED',
              },
            }),
          );
        } finally {
          if (activeTurns.get(sessionId)?.gate === gate) {
            activeTurns.delete(sessionId);
          }
          gate.rejectAll(new Error('turn ended'));
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      })();
    },
    cancel() {
      // Client disconnected (the bridge calls reader.cancel() on res
      // 'close'). Abort the turn so the LLM stream + any sandbox stop.
      abortController.abort();
      gate.rejectAll(new Error('client disconnected'));
      if (activeTurns.get(sessionId)?.gate === gate) {
        activeTurns.delete(sessionId);
      }
    },
  });

  return { status: 200, stream };
}

/**
 * `POST /agents/sessions/:id/control` — route a control frame into the
 * in-flight turn (interrupt / permission-response / human-input-response).
 */
async function controlSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const sessionId = deps.endpointCtx.params.id;
  if (!sessionId) {
    return badRequest('Missing session id');
  }
  const body = (deps.endpointCtx.body ?? {}) as {
    type?: string;
    id?: string;
    decision?: unknown;
    response?: unknown;
  };
  const turn = activeTurns.get(sessionId);
  if (!turn) {
    return { status: 409, body: { error: 'No active turn for this session' } };
  }
  switch (body.type) {
    case 'flowlib.interrupt':
      turn.abort();
      return { status: 200, body: { ok: true } };
    case 'flowlib.permission-response':
      if (typeof body.id === 'string') {
        turn.gate.resolvePermission(body.id, body.decision);
      }
      return { status: 200, body: { ok: true } };
    case 'flowlib.hil-response':
      if (typeof body.id === 'string') {
        turn.gate.resolveHumanInput(body.id, body.response);
      }
      return { status: 200, body: { ok: true } };
    default:
      return badRequest('Unknown control type', { type: body.type });
  }
}

/** Pull the prompt out of `{ text }` or a `{ messages: [...] }` body. */
function extractPromptText(body: Record<string, unknown> | undefined): string | null {
  if (!body) {
    return null;
  }
  const text = bodyString(body, 'text');
  if (text && text.length > 0) {
    return text;
  }
  const messages = body.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const last = messages[messages.length - 1] as { content?: unknown; parts?: unknown };
    if (typeof last.content === 'string' && last.content.length > 0) {
      return last.content;
    }
    if (Array.isArray(last.parts)) {
      const joined = last.parts
        .filter(
          (p): p is { type: string; text: string } =>
            typeof p === 'object' &&
            p !== null &&
            (p as { type?: unknown }).type === 'text' &&
            typeof (p as { text?: unknown }).text === 'string',
        )
        .map((p) => p.text)
        .join('');
      return joined.length > 0 ? joined : null;
    }
  }
  return null;
}

export function createChatStreamEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'POST',
      path: '/agents/sessions/:id/stream',
      handler: safeHandler(ctx, streamSession),
    },
    {
      method: 'POST',
      path: '/agents/sessions/:id/control',
      handler: safeHandler(ctx, controlSession),
    },
  ];
}
