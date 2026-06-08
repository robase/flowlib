/**
 * Component tests for `ToolCallCard`.
 *
 * **Runtime note**: see header in `MessageBubble.test.tsx`. The matching
 * runnable file is `groupChatEvents.test.ts` (covers the call/result
 * pairing) plus the structural assertions here using
 * `react-dom/server`'s `renderToString`.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ToolCallCard } from '../components/ToolCallCard';
import type { ToolCallEvent, ToolResultEvent } from '../../shared/events';

const baseCall: ToolCallEvent = {
  type: 'tool-call',
  messageId: 'm1',
  id: 'c1',
  name: 'read_file',
  input: { path: 'README.md' },
};

describe('ToolCallCard', () => {
  it('is collapsed by default — does not render input', () => {
    const html = renderToString(<ToolCallCard call={baseCall} />);
    expect(html).toContain('read_file');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('"path":');
  });

  it('renders the input payload when defaultOpen=true', () => {
    const html = renderToString(<ToolCallCard call={baseCall} defaultOpen />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('README.md');
  });

  it('shows status label "running…" while result is pending', () => {
    const html = renderToString(<ToolCallCard call={baseCall} />);
    expect(html).toContain('running…');
  });

  it('shows status "done" once a non-error result arrives', () => {
    const result: ToolResultEvent = {
      type: 'tool-result',
      messageId: 'm1',
      id: 'c1',
      output: 'ok',
    };
    const html = renderToString(<ToolCallCard call={baseCall} result={result} />);
    expect(html).toContain('done');
  });

  it('renders error styling when result has isError=true', () => {
    const result: ToolResultEvent = {
      type: 'tool-result',
      messageId: 'm1',
      id: 'c1',
      output: 'boom',
      isError: true,
    };
    const html = renderToString(<ToolCallCard call={baseCall} result={result} defaultOpen />);
    expect(html).toContain('error');
    expect(html).toContain('border-destructive');
  });
});
