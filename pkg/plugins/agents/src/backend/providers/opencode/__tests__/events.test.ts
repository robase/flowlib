/**
 * Unit tests for the opencode SSE → `AgentEvent` mapper.
 *
 * The mapper is deliberately stateless (modulo a small per-turn
 * dedup state), so the tests exercise it directly with hand-rolled
 * fixture events that mirror the shapes in `@opencode-ai/sdk`'s
 * `Event` union. Wiring against the real SDK is the runtime tests'
 * job.
 */
import { describe, it, expect } from 'vitest';
import {
  mapOpencodeEvent,
  createMapperState,
  type OpencodeEvent,
} from '../events';
import type { AgentEvent } from '../../../../shared/events';

// ─── Fixture builders ───────────────────────────────────────────────────

function textDelta(messageId: string, delta: string, partId = 'p1'): OpencodeEvent {
  return {
    type: 'message.part.updated',
    properties: {
      delta,
      part: {
        id: partId,
        sessionID: 'session-1',
        messageID: messageId,
        type: 'text',
        text: '',
      },
    },
  } as OpencodeEvent;
}

function toolPart(
  messageId: string,
  callId: string,
  tool: string,
  state:
    | { status: 'pending'; input: Record<string, unknown> }
    | { status: 'running'; input: Record<string, unknown> }
    | { status: 'completed'; input: Record<string, unknown>; output: string }
    | { status: 'error'; input: Record<string, unknown>; error: string },
): OpencodeEvent {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `tool-${callId}`,
        sessionID: 'session-1',
        messageID: messageId,
        type: 'tool',
        callID: callId,
        tool,
        state,
      },
    },
  } as OpencodeEvent;
}

// ─── text-delta ────────────────────────────────────────────────────────

describe('mapOpencodeEvent — text', () => {
  it('emits text-delta from a part.updated with a delta', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(textDelta('m1', 'Hello'), state);
    expect(out).toEqual<AgentEvent[]>([
      { type: 'text-delta', messageId: 'm1', text: 'Hello' },
    ]);
  });

  it('falls back to part.text when no delta supplied', () => {
    const state = createMapperState();
    const evt: OpencodeEvent = {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'p1',
          sessionID: 's',
          messageID: 'm2',
          type: 'text',
          text: 'whole message',
        } as never,
      },
    } as OpencodeEvent;
    expect(mapOpencodeEvent(evt, state)).toEqual<AgentEvent[]>([
      { type: 'text-delta', messageId: 'm2', text: 'whole message' },
    ]);
  });

  it('drops empty text deltas', () => {
    const state = createMapperState();
    expect(mapOpencodeEvent(textDelta('m1', ''), state)).toEqual([]);
  });

  it('tracks lastMessageId for terminator events', () => {
    const state = createMapperState();
    mapOpencodeEvent(textDelta('m9', 'hi'), state);
    expect(state.lastMessageId).toBe('m9');
  });
});

// ─── tool-call / tool-result ───────────────────────────────────────────

describe('mapOpencodeEvent — tool', () => {
  it('emits tool-call exactly once across pending → running → completed', () => {
    const state = createMapperState();
    const collected: AgentEvent[] = [];
    collected.push(
      ...mapOpencodeEvent(
        toolPart('m1', 'c1', 'read_file', { status: 'pending', input: { path: 'x' } }),
        state,
      ),
    );
    collected.push(
      ...mapOpencodeEvent(
        toolPart('m1', 'c1', 'read_file', { status: 'running', input: { path: 'x' } }),
        state,
      ),
    );
    collected.push(
      ...mapOpencodeEvent(
        toolPart('m1', 'c1', 'read_file', {
          status: 'completed',
          input: { path: 'x' },
          output: 'contents',
        }),
        state,
      ),
    );

    const calls = collected.filter((e) => e.type === 'tool-call');
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      type: 'tool-call',
      id: 'c1',
      name: 'read_file',
      input: { path: 'x' },
    });
  });

  it('emits tool-result with output on completion', () => {
    const state = createMapperState();
    mapOpencodeEvent(
      toolPart('m1', 'c1', 'read_file', { status: 'running', input: { path: 'x' } }),
      state,
    );
    const out = mapOpencodeEvent(
      toolPart('m1', 'c1', 'read_file', {
        status: 'completed',
        input: { path: 'x' },
        output: 'contents',
      }),
      state,
    );
    expect(out).toContainEqual({
      type: 'tool-result',
      messageId: 'm1',
      id: 'c1',
      output: 'contents',
    });
  });

  it('emits tool-result with isError: true on error', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      toolPart('m1', 'c1', 'bash', {
        status: 'error',
        input: { command: 'rm -rf /' },
        error: 'denied',
      }),
      state,
    );
    expect(out).toEqual<AgentEvent[]>([
      { type: 'tool-call', messageId: 'm1', id: 'c1', name: 'bash', input: { command: 'rm -rf /' } },
      {
        type: 'tool-result',
        messageId: 'm1',
        id: 'c1',
        output: 'denied',
        isError: true,
      },
    ]);
  });

  it('synthesises file-edit when a Write tool completes (file_path key)', () => {
    const state = createMapperState();
    mapOpencodeEvent(
      toolPart('m1', 'c2', 'write', { status: 'running', input: { file_path: '/src/x.ts' } }),
      state,
    );
    const out = mapOpencodeEvent(
      toolPart('m1', 'c2', 'write', {
        status: 'completed',
        input: { file_path: '/src/x.ts' },
        output: 'wrote 200 bytes',
      }),
      state,
    );
    expect(out).toContainEqual({
      type: 'file-edit',
      messageId: 'm1',
      path: '/src/x.ts',
    });
  });

  it('synthesises file-edit for an Edit tool with `path` key', () => {
    const state = createMapperState();
    mapOpencodeEvent(
      toolPart('m1', 'c3', 'edit', { status: 'pending', input: { path: '/x' } }),
      state,
    );
    const out = mapOpencodeEvent(
      toolPart('m1', 'c3', 'edit', {
        status: 'completed',
        input: { path: '/x' },
        output: 'ok',
      }),
      state,
    );
    expect(out.some((e) => e.type === 'file-edit' && e.path === '/x')).toBe(true);
  });

  it('does NOT synthesise file-edit for a non-mutating tool', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      toolPart('m1', 'c4', 'read', {
        status: 'completed',
        input: { path: '/x' },
        output: 'data',
      }),
      state,
    );
    expect(out.find((e) => e.type === 'file-edit')).toBeUndefined();
  });
});

// ─── permission ────────────────────────────────────────────────────────

describe('mapOpencodeEvent — permission', () => {
  it('emits permission-request from permission.updated', () => {
    const state = createMapperState();
    const evt: OpencodeEvent = {
      type: 'permission.updated',
      properties: {
        id: 'perm-1',
        sessionID: 'session-1',
        messageID: 'm1',
        callID: 'c1',
        type: 'bash',
        title: 'Approve bash',
        pattern: 'rm *',
        metadata: { foo: 1 },
      },
    };
    const out = mapOpencodeEvent(evt, state);
    expect(out).toEqual<AgentEvent[]>([
      {
        type: 'permission-request',
        id: 'perm-1',
        tool: 'bash',
        input: { title: 'Approve bash', pattern: 'rm *', metadata: { foo: 1 } },
      },
    ]);
  });
});

// ─── file.edited (synthesised file-edit) ──────────────────────────────

describe('mapOpencodeEvent — file.edited', () => {
  it('emits file-edit using the last tracked messageId', () => {
    const state = createMapperState();
    state.lastMessageId = 'm77';
    const out = mapOpencodeEvent(
      { type: 'file.edited', properties: { file: '/a/b.ts' } },
      state,
    );
    expect(out).toEqual<AgentEvent[]>([
      { type: 'file-edit', messageId: 'm77', path: '/a/b.ts' },
    ]);
  });

  it('drops file.edited when no messageId is known yet (pre-prompt)', () => {
    const state = createMapperState();
    // We *do* still emit an event, with an empty messageId — this is the
    // documented behaviour. UI clients can decide to drop or attach
    // it. Locking this in via test so it doesn't regress silently.
    const out = mapOpencodeEvent(
      { type: 'file.edited', properties: { file: '/x' } },
      state,
    );
    expect(out).toEqual<AgentEvent[]>([
      { type: 'file-edit', messageId: '', path: '/x' },
    ]);
  });
});

// ─── message-complete ──────────────────────────────────────────────────

describe('mapOpencodeEvent — message-complete', () => {
  it('emits message-complete from message.updated when time.completed is set', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'm1',
            role: 'assistant',
            sessionID: 's',
            time: { created: 1, completed: 2 },
            tokens: {
              input: 10,
              output: 20,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
      state,
    );
    expect(out).toEqual<AgentEvent[]>([
      {
        type: 'message-complete',
        messageId: 'm1',
        usage: { inputTokens: 10, outputTokens: 20 },
      },
    ]);
  });

  it('does not emit message-complete for a still-streaming assistant message', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      {
        type: 'message.updated',
        properties: {
          info: { id: 'm1', role: 'assistant', sessionID: 's', time: { created: 1 } },
        },
      },
      state,
    );
    expect(out).toEqual([]);
  });

  it('does not emit message-complete for user messages', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      {
        type: 'message.updated',
        properties: {
          info: { id: 'u1', role: 'user', sessionID: 's', time: { created: 1, completed: 1 } },
        },
      },
      state,
    );
    expect(out).toEqual([]);
  });

  it('emits message-complete from session.idle if message.updated did not', () => {
    const state = createMapperState();
    state.lastMessageId = 'm1';
    const out = mapOpencodeEvent(
      { type: 'session.idle', properties: { sessionID: 's' } },
      state,
    );
    expect(out).toEqual<AgentEvent[]>([
      { type: 'message-complete', messageId: 'm1' },
    ]);
  });

  it('does not double-fire message-complete (suppresses idle when already completed)', () => {
    const state = createMapperState();
    mapOpencodeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'm1',
            role: 'assistant',
            sessionID: 's',
            time: { created: 1, completed: 2 },
          },
        },
      },
      state,
    );
    const out = mapOpencodeEvent(
      { type: 'session.idle', properties: { sessionID: 's' } },
      state,
    );
    expect(out).toEqual([]);
  });
});

// ─── session.error ─────────────────────────────────────────────────────

describe('mapOpencodeEvent — session.error', () => {
  it('emits session-end with reason: "error" and the error message', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      {
        type: 'session.error',
        properties: {
          error: { name: 'APIError', data: { message: 'rate limit' } },
        },
      },
      state,
    );
    expect(out).toEqual<AgentEvent[]>([
      { type: 'session-end', reason: 'error', error: 'rate limit' },
    ]);
  });

  it('falls back to error.name when data.message is missing', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent(
      { type: 'session.error', properties: { error: { name: 'UnknownError' } } },
      state,
    );
    expect(out[0]).toMatchObject({ type: 'session-end', reason: 'error', error: 'UnknownError' });
  });

  it('falls back to a generic message when no error object present', () => {
    const state = createMapperState();
    const out = mapOpencodeEvent({ type: 'session.error', properties: {} }, state);
    expect(out[0]).toMatchObject({ type: 'session-end', reason: 'error' });
    expect((out[0] as { error: string }).error).toBeTruthy();
  });
});

// ─── unhandled / dropped ────────────────────────────────────────────────

describe('mapOpencodeEvent — unmapped events', () => {
  it.each([
    'session.created',
    'session.updated',
    'session.deleted',
    'vcs.branch.updated',
    'tui.toast.show',
    'lsp.updated',
    'message.removed',
  ])('drops %s', (type) => {
    const state = createMapperState();
    const out = mapOpencodeEvent({ type, properties: {} } as OpencodeEvent, state);
    expect(out).toEqual([]);
  });
});
