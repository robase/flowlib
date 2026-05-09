/**
 * Component tests for `ChatStream`.
 *
 * **Runtime note**: see header in `MessageBubble.test.tsx`. Logic-only
 * coverage is in `groupChatEvents.test.ts`. The structural assertions
 * here use `react-dom/server`'s `renderToString`.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ChatStream } from '../components/ChatStream';
import type { AgentEvent } from '../../shared/events';

describe('ChatStream', () => {
  it('renders aria-live="polite" log container', () => {
    const html = renderToString(
      <ChatStream
        events={[]}
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
  });

  it('renders text-delta as an assistant bubble', () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'a', text: 'hello world' },
    ];
    const html = renderToString(
      <ChatStream
        events={events}
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('hello world');
    expect(html).toContain('data-role="assistant"');
  });

  it('renders pending user bubbles before assistant blocks', () => {
    const html = renderToString(
      <ChatStream
        events={[]}
        pendingUser={[{ id: 'p1', text: 'optimistic message' }]}
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('optimistic message');
    expect(html).toContain('data-role="user"');
  });

  it('renders permission prompt block', () => {
    const events: AgentEvent[] = [
      {
        type: 'permission-request',
        id: 'p1',
        tool: 'Bash',
        input: { command: 'ls' },
      },
    ];
    const html = renderToString(
      <ChatStream
        events={events}
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('Approve');
    expect(html).toContain('Bash');
  });

  it('renders file-edit diff block', () => {
    const events: AgentEvent[] = [
      {
        type: 'file-edit',
        messageId: 'm1',
        path: 'src/foo.ts',
        before: 'a\nb',
        after: 'a\nB',
      },
    ];
    const html = renderToString(
      <ChatStream
        events={events}
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('src/foo.ts');
    // React SSR inserts an empty HTML comment between adjacent text
    // nodes (e.g. `+` and `1`). Strip them before asserting.
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(stripped).toMatch(/\+1/);
    expect(stripped).toMatch(/-1/);
  });

  it('shows Thinking… when streaming with no events', () => {
    const html = renderToString(
      <ChatStream
        events={[]}
        streaming
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('Thinking');
  });

  it('renders session-end status', () => {
    const events: AgentEvent[] = [
      { type: 'session-end', reason: 'completed' },
    ];
    const html = renderToString(
      <ChatStream
        events={events}
        onPermissionRespond={() => {}}
        onHilRespond={() => {}}
      />,
    );
    expect(html).toContain('Session ended');
    expect(html).toContain('completed');
  });
});
