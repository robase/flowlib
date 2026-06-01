/**
 * ToolFallback — assistant-ui fallback renderer for any tool call that
 * doesn't have a dedicated `by_name` component.
 *
 * Adapts assistant-ui's `ToolCallMessagePartProps` to our existing
 * `ToolCallCard`, which expects `ToolCallEvent` / `ToolResultEvent`.
 */
import * as React from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ToolCallCard } from '../ToolCallCard';
import type { ToolCallEvent, ToolResultEvent } from '../../../shared/events';

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolCallId,
  toolName,
  args,
  result,
  isError,
}) => {
  const call: ToolCallEvent = {
    type: 'tool-call',
    messageId: '',
    id: toolCallId,
    name: toolName,
    input: args,
  };
  const resultEvent: ToolResultEvent | undefined =
    result !== undefined
      ? {
          type: 'tool-result',
          messageId: '',
          id: toolCallId,
          output: result,
          isError,
        }
      : undefined;
  return <ToolCallCard call={call} result={resultEvent} />;
};
