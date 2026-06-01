/**
 * Pure parser for inbound WebSocket frames from the AgentChatDO.
 *
 * Lives in its own module so unit tests (and any other consumer that
 * only wants the parser) can import it without pulling in the React
 * hook surface — `useChatStream` transitively depends on `@flowlib/ui`
 * via `useAgentsApiClients`, which pulls in `triggers.api.ts` →
 * `decode-named-character-reference` → `document`, none of which are
 * available in the workerd / Node test pool. Keeping this helper
 * separate avoids that chain.
 */

import { isAgentEvent, type AgentEvent } from '../../shared/events';

export type ParsedInboundFrame =
  | { kind: 'agent-event'; event: AgentEvent }
  | { kind: 'agent-error'; error: { message: string; code?: string } }
  | { kind: 'unknown' };

export function parseInboundFrame(data: unknown): ParsedInboundFrame {
  if (typeof data !== 'string') {
    return { kind: 'unknown' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { kind: 'unknown' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'unknown' };
  }
  const env = parsed as { type?: unknown; event?: unknown; error?: unknown };
  if (env.type === 'flowlib.agent-event' && env.event && isAgentEvent(env.event)) {
    return { kind: 'agent-event', event: env.event };
  }
  if (env.type === 'flowlib.agent-error' && env.error && typeof env.error === 'object') {
    const err = env.error as { message?: unknown; code?: unknown };
    return {
      kind: 'agent-error',
      error: {
        message: typeof err.message === 'string' ? err.message : 'Unknown error',
        code: typeof err.code === 'string' ? err.code : undefined,
      },
    };
  }
  return { kind: 'unknown' };
}
