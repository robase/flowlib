'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/workspace/types';
import { ToolCallCard } from './tool-call-card';
import { SubAgentCard } from './sub-agent-card';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium',
          isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary/15 text-primary',
        )}
        aria-hidden="true"
      >
        {isUser ? 'You' : <Sparkles className="h-4 w-4" />}
      </div>

      <div className={cn('min-w-0 max-w-2xl space-y-2', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-lg px-4 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'bg-secondary text-secondary-foreground'
              : 'bg-card text-card-foreground border border-border',
          )}
        >
          <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full space-y-1.5">
            {message.toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
          </div>
        )}

        {/* Sub-agents */}
        {message.subAgents && message.subAgents.length > 0 && (
          <div className="w-full space-y-1.5">
            {message.subAgents.map((run) => (
              <SubAgentCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
