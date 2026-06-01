/**
 * Pure-logic tests for `parseInboundFrame`.
 *
 * Runs in the workerd test pool — no DOM dependency. The matching
 * `useChatStream.test.tsx` exercises the same scenarios at the hook
 * level once a DOM-capable vitest environment is wired up.
 */
import { describe, it, expect } from 'vitest';
import { parseInboundFrame } from '../hooks/parse-inbound-frame';

describe('parseInboundFrame', () => {
  it('decodes a valid agent-event envelope', () => {
    const data = JSON.stringify({
      type: 'flowlib.agent-event',
      event: { type: 'text-delta', messageId: 'm1', text: 'hi' },
    });
    const result = parseInboundFrame(data);
    expect(result.kind).toBe('agent-event');
    if (result.kind === 'agent-event') {
      expect(result.event).toMatchObject({
        type: 'text-delta',
        text: 'hi',
      });
    }
  });

  it('decodes a tool-call event envelope', () => {
    const data = JSON.stringify({
      type: 'flowlib.agent-event',
      event: {
        type: 'tool-call',
        messageId: 'm1',
        id: 'c1',
        name: 'foo',
        input: {},
      },
    });
    const result = parseInboundFrame(data);
    expect(result.kind).toBe('agent-event');
  });

  it('decodes a session-end event envelope', () => {
    const data = JSON.stringify({
      type: 'flowlib.agent-event',
      event: { type: 'session-end', reason: 'completed' },
    });
    const result = parseInboundFrame(data);
    expect(result.kind).toBe('agent-event');
  });

  it('decodes an agent-error envelope', () => {
    const data = JSON.stringify({
      type: 'flowlib.agent-error',
      error: { message: 'boom', code: 'ETEST' },
    });
    const result = parseInboundFrame(data);
    expect(result).toMatchObject({
      kind: 'agent-error',
      error: { message: 'boom', code: 'ETEST' },
    });
  });

  it('falls back to "Unknown error" on missing message', () => {
    const data = JSON.stringify({
      type: 'flowlib.agent-error',
      error: {},
    });
    const result = parseInboundFrame(data);
    expect(result).toMatchObject({
      kind: 'agent-error',
      error: { message: 'Unknown error' },
    });
  });

  it('returns unknown for non-string data', () => {
    expect(parseInboundFrame(undefined).kind).toBe('unknown');
    expect(parseInboundFrame(12).kind).toBe('unknown');
  });

  it('returns unknown for invalid JSON', () => {
    expect(parseInboundFrame('not json').kind).toBe('unknown');
  });

  it('returns unknown for unrelated envelope types (SDK chatter)', () => {
    const data = JSON.stringify({
      type: 'cf_agent_state_update',
      payload: {},
    });
    expect(parseInboundFrame(data).kind).toBe('unknown');
  });

  it('returns unknown when "event" payload is malformed', () => {
    const data = JSON.stringify({
      type: 'flowlib.agent-event',
      event: { type: 'not-a-real-type' },
    });
    expect(parseInboundFrame(data).kind).toBe('unknown');
  });
});
