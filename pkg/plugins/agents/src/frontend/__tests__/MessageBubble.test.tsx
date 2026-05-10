/**
 * Component tests for `MessageBubble`.
 *
 * **Runtime note**: the package's current vitest config
 * (`@cloudflare/vitest-pool-workers`) only picks up `*.test.ts` and
 * lacks a DOM environment. This `.test.tsx` file lives at the path the
 * stream brief requires; it will become live once a DOM-capable vitest
 * project is added (happy-dom + a separate include pattern).
 *
 * In the meantime, equivalent pure-logic coverage lives in
 * `MessageBubble-helpers.test.ts`. The structural assertions here use
 * `react-dom/server`'s `renderToString` (no DOM needed, works in
 * workerd) so flipping the config on costs nothing.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from '../components/MessageBubble';

describe('MessageBubble', () => {
  it('renders user text inside a user-styled bubble', () => {
    const html = renderToString(<MessageBubble role="user" text="hello" />);
    expect(html).toContain('hello');
    expect(html).toContain('data-role="user"');
  });

  it('splits paragraphs on blank lines', () => {
    const html = renderToString(<MessageBubble role="assistant" text="first\n\nsecond" />);
    expect(html).toContain('first');
    expect(html).toContain('second');
  });

  it('shows a streaming cursor when streaming=true', () => {
    const html = renderToString(<MessageBubble role="assistant" text="partial" streaming />);
    expect(html).toContain('animate-pulse');
    expect(html).toContain('data-streaming="true"');
  });

  it('renders nothing visible when text is empty and not streaming', () => {
    const html = renderToString(<MessageBubble role="assistant" text="" />);
    // No paragraphs produced; cursor only when streaming.
    expect(html).not.toContain('animate-pulse');
  });
});
