/**
 * Pure-logic tests for `groupChatEvents`. These run under the current
 * `@cloudflare/vitest-pool-workers` config without needing a DOM.
 *
 * The brief mandates component tests (.test.tsx); those live alongside
 * but are dormant until vitest-config gains a DOM environment. This
 * file covers the same scenarios at the logic level so coverage is real.
 */
import { describe, it, expect } from 'vitest';
import { groupChatEvents } from '../components/ChatStream';
import type { AgentEvent } from '../../shared/events';

describe('groupChatEvents — text deltas', () => {
  it('collapses consecutive text-delta events with the same messageId into a single bubble', () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'm1', text: 'Hello, ' },
      { type: 'text-delta', messageId: 'm1', text: 'world' },
      { type: 'text-delta', messageId: 'm1', text: '!' },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'assistant-text',
      id: 'm1',
      text: 'Hello, world!',
      streaming: true,
    });
  });

  it('marks bubble streaming=false on message-complete', () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'm1', text: 'done' },
      { type: 'message-complete', messageId: 'm1' },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'assistant-text',
      streaming: false,
    });
  });

  it('treats different messageIds as separate bubbles', () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'a', text: 'first' },
      { type: 'text-delta', messageId: 'b', text: 'second' },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'assistant-text', text: 'first' });
    expect(blocks[1]).toMatchObject({ kind: 'assistant-text', text: 'second' });
  });

  it('forces all assistant-text streaming=false when isStreaming option is false', () => {
    const events: AgentEvent[] = [{ type: 'text-delta', messageId: 'm1', text: 'hi' }];
    const blocks = groupChatEvents(events, { isStreaming: false });
    expect(blocks[0]).toMatchObject({ streaming: false });
  });
});

describe('groupChatEvents — tool calls', () => {
  it('pairs tool-call with matching tool-result by id', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        messageId: 'm1',
        id: 'call-1',
        name: 'read_file',
        input: { path: 'README.md' },
      },
      {
        type: 'tool-result',
        messageId: 'm1',
        id: 'call-1',
        output: 'file contents',
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'call-1',
      call: { name: 'read_file' },
      result: { output: 'file contents' },
    });
  });

  it('keeps tool block without result while in flight', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        messageId: 'm1',
        id: 'call-1',
        name: 'edit_file',
        input: {},
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks[0]).toMatchObject({ kind: 'tool', id: 'call-1' });
    expect((blocks[0] as { result?: unknown }).result).toBeUndefined();
  });

  it('handles orphan tool-result with synthetic call', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-result',
        messageId: 'm1',
        id: 'orphan',
        output: 42,
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'orphan',
      call: { name: '(unknown tool)' },
      result: { output: 42 },
    });
  });

  it('preserves event ordering with interleaved text and tool calls', () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'm1', text: 'I will read ' },
      {
        type: 'tool-call',
        messageId: 'm1',
        id: 'c1',
        name: 'read',
        input: {},
      },
      {
        type: 'tool-result',
        messageId: 'm1',
        id: 'c1',
        output: 'ok',
      },
      { type: 'text-delta', messageId: 'm2', text: 'Done.' },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].kind).toBe('assistant-text');
    expect(blocks[1].kind).toBe('tool');
    expect(blocks[2].kind).toBe('assistant-text');
  });
});

describe('groupChatEvents — file edits', () => {
  it('emits a file-edit block per event', () => {
    const events: AgentEvent[] = [
      {
        type: 'file-edit',
        messageId: 'm1',
        path: 'src/foo.ts',
        before: 'old',
        after: 'new',
      },
      {
        type: 'file-edit',
        messageId: 'm1',
        path: 'src/bar.ts',
        before: '',
        after: 'created',
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: 'file-edit',
      event: { path: 'src/foo.ts' },
    });
    expect(blocks[1]).toMatchObject({
      kind: 'file-edit',
      event: { path: 'src/bar.ts' },
    });
  });
});

describe('groupChatEvents — permission + HIL + session-end', () => {
  it('emits a permission block', () => {
    const events: AgentEvent[] = [
      {
        type: 'permission-request',
        id: 'p1',
        tool: 'Bash',
        input: { command: 'ls' },
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks[0]).toMatchObject({
      kind: 'permission',
      id: 'p1',
      event: { tool: 'Bash' },
    });
  });

  it('emits a hil block', () => {
    const events: AgentEvent[] = [
      {
        type: 'human-input-request',
        id: 'h1',
        prompt: 'Pick a file',
        blocking: true,
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks[0]).toMatchObject({ kind: 'hil', id: 'h1' });
  });

  it('emits a session-end block with reason', () => {
    const events: AgentEvent[] = [
      {
        type: 'session-end',
        reason: 'completed',
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks[0]).toMatchObject({
      kind: 'session-end',
      reason: 'completed',
    });
  });

  it('passes through error reason on session-end', () => {
    const events: AgentEvent[] = [
      {
        type: 'session-end',
        reason: 'error',
        error: 'boom',
      },
    ];
    const blocks = groupChatEvents(events);
    expect(blocks[0]).toMatchObject({ reason: 'error', error: 'boom' });
  });
});
