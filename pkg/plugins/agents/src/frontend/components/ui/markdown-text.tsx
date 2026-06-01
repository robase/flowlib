/**
 * MarkdownText — assistant-message text renderer that supports markdown.
 *
 * Thin wrapper around `MarkdownTextPrimitive` configured with prose-ish
 * Tailwind classes keyed to `fl-*` theme tokens. Streamed text uses the
 * dotted in-progress cursor from `@assistant-ui/react-markdown/styles/dot.css`
 * (imported once at the chat root).
 */
import * as React from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { cn } from '../../lib/cn';

const proseClass = cn(
  'prose prose-sm max-w-none',
  'prose-p:my-2 prose-p:leading-relaxed',
  'prose-pre:my-2 prose-pre:bg-fl-muted/40 prose-pre:text-fl-foreground prose-pre:rounded-md prose-pre:p-3 prose-pre:text-xs prose-pre:overflow-x-auto',
  'prose-code:bg-fl-muted/40 prose-code:text-fl-foreground prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none',
  'prose-headings:font-semibold prose-headings:text-fl-foreground',
  'prose-h1:text-base prose-h2:text-sm prose-h3:text-sm',
  'prose-strong:text-fl-foreground prose-strong:font-semibold',
  'prose-a:text-fl-primary prose-a:underline-offset-2 hover:prose-a:underline',
  'prose-blockquote:border-l-2 prose-blockquote:border-fl-border prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-fl-muted-foreground',
  'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
  'prose-hr:border-fl-border prose-hr:my-3',
  'text-fl-foreground',
);

export const MarkdownText: TextMessagePartComponent = () => {
  return <MarkdownTextPrimitive className={proseClass} smooth />;
};
