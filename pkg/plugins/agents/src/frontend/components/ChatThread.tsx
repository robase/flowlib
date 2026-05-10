/**
 * ChatThread — assistant-ui Thread primitive composition for one chat
 * session.
 *
 * Mounts an `<AssistantRuntimeProvider>` keyed by `sessionId` so that
 * switching threads tears down + rebuilds the runtime (history reload,
 * fresh live event stream).
 *
 * The runtime adapter (`useAgentRuntime`) projects every non-text
 * `AgentEvent` (tool-call, file-edit, permission-request,
 * human-input-request) onto a synthetic tool-call message part. This
 * file's `ToolCall` component switches on the part's `toolName` to
 * dispatch to the right custom renderer:
 *
 *   - `__flowlib_file_edit__`  → `FileDiffViewer`
 *   - `__flowlib_permission__` → `PermissionRequestPrompt`
 *   - `__flowlib_human_input__` → `HumanInputCard`
 *   - everything else          → `ToolCallCard`
 *
 * The interactive renderers (permission, HIL) read the response
 * handlers from `AgentStreamContext`.
 */
import * as React from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { ArrowUp, Bot, Square, User } from 'lucide-react';
import { useAgentRuntime } from '../hooks/useAgentRuntime';
import { FLOWLIB_TOOL_NAMES } from '../hooks/useAgentRuntime';
import { AgentStreamProvider, useAgentStream } from './AgentStreamContext';
import { ToolCallCard } from './ToolCallCard';
import { FileDiffViewer } from './FileDiffViewer';
import { PermissionRequestPrompt } from './PermissionRequestPrompt';
import { HumanInputCard } from './HumanInputCard';
import type { AgentSession } from '../../shared/types';
import type {
  FileEditEvent,
  HumanInputRequestEvent,
  PermissionRequestEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../../shared/events';

export interface ChatThreadProps {
  session: AgentSession;
}

export function ChatThread({ session }: ChatThreadProps): React.ReactElement {
  // Key the inner runtime by session.id so a thread switch fully
  // remounts. Also re-mounts on credential / model changes that the
  // session API surfaces — those are static enough that a remount is
  // acceptable and avoids stale cached message state.
  return <ChatThreadInner key={session.id} session={session} />;
}

function ChatThreadInner({ session }: ChatThreadProps): React.ReactElement {
  const { runtime, isLoadingHistory, stream } = useAgentRuntime(session.id);

  return (
    <AgentStreamProvider
      controls={{
        permissionResponse: stream.permissionResponse,
        hilResponse: stream.hilResponse,
        resolvedPermissions: stream.resolvedPermissions,
        resolvedHumanInputs: stream.resolvedHumanInputs,
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex flex-col h-full min-h-0">
          <ChatHeader session={session} status={stream.status} error={stream.error} />
          <ThreadPrimitive.Root className="flex flex-col flex-1 min-h-0 bg-fl-background">
            <ThreadPrimitive.Viewport
              className="flex-1 overflow-y-auto"
              data-testid="agents-thread-viewport"
            >
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-12 text-sm text-fl-muted-foreground">
                  Loading history…
                </div>
              ) : (
                // Only show the "type a message…" hint once history has
                // resolved — otherwise it flashes briefly underneath the
                // loading row while the snapshot is in flight.
                <ThreadPrimitive.Empty>
                  <EmptyState session={session} />
                </ThreadPrimitive.Empty>
              )}

              <div className="mx-auto max-w-3xl w-full px-4 py-6 space-y-4">
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage,
                  }}
                />
              </div>
            </ThreadPrimitive.Viewport>

            <ChatComposer />
          </ThreadPrimitive.Root>
        </div>
      </AssistantRuntimeProvider>
    </AgentStreamProvider>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function ChatHeader({
  session,
  status,
  error,
}: {
  session: AgentSession;
  status: 'connecting' | 'streaming' | 'idle' | 'error';
  error?: string;
}): React.ReactElement {
  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-fl-border bg-fl-background">
      <div className="flex items-center gap-2 min-w-0">
        <Bot className="size-4 text-fl-primary shrink-0" />
        <span className="text-sm font-semibold truncate">{session.title}</span>
        <span className="text-xs text-fl-muted-foreground truncate">
          {session.providerId}
          {session.model ? ` · ${session.model}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {status === 'error' && error ? (
          <span className="text-xs text-fl-destructive" role="alert">
            {error}
          </span>
        ) : (
          <span
            className="text-xs text-fl-muted-foreground"
            data-testid="agents-connection-status"
          >
            {humanStatus(status)}
          </span>
        )}
      </div>
    </header>
  );
}

function humanStatus(status: 'connecting' | 'streaming' | 'idle' | 'error'): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'streaming':
      return 'Streaming…';
    case 'idle':
      return 'Ready';
    case 'error':
      return 'Error';
  }
}

// ─── Messages ───────────────────────────────────────────────────────────

function UserMessage(): React.ReactElement {
  return (
    <MessagePrimitive.Root
      className="flex gap-3 justify-end"
      data-role="user"
      data-testid="agents-message-user"
    >
      <div className="max-w-[80%] rounded-lg bg-fl-primary text-fl-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
        <MessagePrimitive.Content />
      </div>
      <Avatar role="user" />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage(): React.ReactElement {
  return (
    <MessagePrimitive.Root
      className="flex gap-3"
      data-role="assistant"
      data-testid="agents-message-assistant"
    >
      <Avatar role="assistant" />
      <div className="min-w-0 flex-1 max-w-[80%] space-y-2">
        <MessagePrimitive.Content
          components={{
            Text: AssistantTextPart,
            tools: { Override: AssistantToolCallPart },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

const AssistantTextPart: TextMessagePartComponent = ({ text }) => {
  if (!text) {
    return null;
  }
  return (
    <div className="rounded-lg bg-fl-card text-fl-card-foreground border border-fl-border px-3 py-2 text-sm whitespace-pre-wrap break-words">
      {text}
    </div>
  );
};

/**
 * Tool-call part dispatcher. The runtime adapter projects every
 * non-text `AgentEvent` (file-edit, permission-request,
 * human-input-request) onto a synthetic tool-call part with a
 * sentinel `toolName`; this component switches on the sentinel and
 * mounts the right custom renderer.
 */
const AssistantToolCallPart: ToolCallMessagePartComponent = ({
  toolCallId,
  toolName,
  args,
  result,
  isError,
}) => {
  if (toolName === FLOWLIB_TOOL_NAMES.fileEdit) {
    const event = args as FileEditEvent;
    return <FileDiffViewer event={event} />;
  }
  if (toolName === FLOWLIB_TOOL_NAMES.permission) {
    return <PermissionPart event={args as PermissionRequestEvent} />;
  }
  if (toolName === FLOWLIB_TOOL_NAMES.humanInput) {
    return <HumanInputPart event={args as HumanInputRequestEvent} />;
  }
  // Real tool call. Reconstruct synthetic event objects so we can
  // hand them to the existing `ToolCallCard` renderer unchanged.
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

function PermissionPart({ event }: { event: PermissionRequestEvent }): React.ReactElement {
  const stream = useAgentStream();
  const resolved = stream.resolvedPermissions[event.id] ?? null;
  return (
    <PermissionRequestPrompt
      event={event}
      onRespond={(decision) => stream.permissionResponse(event.id, decision)}
      resolved={resolved}
    />
  );
}

function HumanInputPart({ event }: { event: HumanInputRequestEvent }): React.ReactElement {
  const stream = useAgentStream();
  const resolved = Boolean(stream.resolvedHumanInputs[event.id]);
  return (
    <HumanInputCard
      event={event}
      onRespond={(response) => stream.hilResponse(event.id, response)}
      resolved={resolved}
    />
  );
}

function Avatar({ role }: { role: 'user' | 'assistant' }): React.ReactElement {
  return (
    <div
      className={`size-7 rounded-full flex items-center justify-center shrink-0 ${
        role === 'user'
          ? 'bg-fl-primary/10 text-fl-primary'
          : 'bg-fl-muted/40 text-fl-muted-foreground'
      }`}
    >
      {role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
    </div>
  );
}

function EmptyState({ session }: { session: AgentSession }): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center py-16">
      <div className="text-center max-w-sm">
        <Bot className="size-8 mx-auto text-fl-muted-foreground/60 mb-3" />
        <h2 className="text-base font-semibold text-fl-foreground">{session.title}</h2>
        <p className="text-sm text-fl-muted-foreground mt-1">
          Type a message below to start the conversation.
        </p>
      </div>
    </div>
  );
}

// ─── Composer ───────────────────────────────────────────────────────────

function ChatComposer(): React.ReactElement {
  return (
    <ComposerPrimitive.Root
      className="border-t border-fl-border bg-fl-background p-3"
      data-testid="agents-composer"
    >
      <div className="mx-auto max-w-3xl flex items-end gap-2 rounded-lg border border-fl-border bg-fl-card focus-within:border-fl-primary/60 px-3 py-2">
        <ComposerPrimitive.Input
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-fl-muted-foreground min-h-[2rem] max-h-60"
          placeholder="Send a message…"
          rows={1}
          autoFocus
          data-testid="agents-composer-input"
        />
        <ComposerSendOrCancel />
      </div>
    </ComposerPrimitive.Root>
  );
}

function ComposerSendOrCancel(): React.ReactElement {
  return (
    <>
      <ComposerPrimitive.Send
        className="size-8 inline-flex items-center justify-center rounded-md bg-fl-primary text-fl-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed data-[show=false]:hidden"
        data-testid="agents-composer-send"
        aria-label="Send"
      >
        <ArrowUp className="size-4" />
      </ComposerPrimitive.Send>
      <ComposerPrimitive.Cancel
        className="size-8 inline-flex items-center justify-center rounded-md bg-fl-destructive text-fl-destructive-foreground hover:opacity-90 data-[show=false]:hidden"
        data-testid="agents-composer-cancel"
        aria-label="Stop"
      >
        <Square className="size-3.5" />
      </ComposerPrimitive.Cancel>
    </>
  );
}
