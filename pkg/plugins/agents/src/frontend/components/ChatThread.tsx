/**
 * ChatThread — header + thread viewport + composer for the active
 * chat session.
 *
 * The assistant-ui runtime is hoisted to `AgentsLayout` via
 * `useRemoteThreadListRuntime`. Per-thread session resources
 * (chat-stream WS + history query) are owned by the adapter's
 * `unstable_Provider` (see `ActiveSessionContext`). This component is
 * mounted only when a thread is active, and it just consumes that
 * context — it doesn't create its own runtime.
 *
 * Tool-call dispatching: every non-text `AgentEvent` (file-edit,
 * permission-request, human-input-request) is projected by the
 * runtime adapter onto a synthetic tool-call message part with a
 * `FLOWLIB_*` sentinel `toolName`. The `tools.by_name` map routes
 * each sentinel to its dedicated renderer; everything else falls
 * through to `ToolFallback` (collapsible `ToolCallCard`).
 */
import * as React from 'react';
import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import '@assistant-ui/react-markdown/styles/dot.css';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Bot,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  LoaderIcon,
  PencilIcon,
  RefreshCwIcon,
  Sparkles,
  SquareIcon,
} from 'lucide-react';
import { FLOWLIB_TOOL_NAMES } from '../hooks/useAgentRuntime';
import { useUpdateSession } from '../hooks/useSessions';
import { useActiveSession } from './ActiveSessionContext';
import { useAgentStream } from './AgentStreamContext';
import { ModelSelector, type ModelSelection } from './ModelSelector';
import { StatusDot, streamStatusToDot } from './StatusDot';
import { FileDiffViewer } from './FileDiffViewer';
import { PermissionRequestPrompt } from './PermissionRequestPrompt';
import { HumanInputCard } from './HumanInputCard';
import { TooltipIconButton } from './ui/tooltip-icon-button';
import { MarkdownText } from './ui/markdown-text';
import { ToolFallback } from './ui/tool-fallback';
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from './ui/attachment';
import { cn } from '../lib/cn';
import type { AgentSession } from '../../shared/types';
import type {
  FileEditEvent,
  HumanInputRequestEvent,
  PermissionRequestEvent,
} from '../../shared/events';

const THREAD_STYLE: React.CSSProperties = {
  ['--thread-max-width' as string]: '44rem',
};

export interface ChatThreadProps {
  session: AgentSession;
}

export function ChatThread({ session }: ChatThreadProps): React.ReactElement {
  const active = useActiveSession();
  const status = active?.stream.status ?? 'connecting';
  const error = active?.stream.error;
  // Only show the history spinner while a real session's first fetch is
  // genuinely in flight. Defaulting to `true` (no active session / no
  // sessionId yet) left a brand-new empty chat stuck on "Loading history…".
  const isLoadingHistory = Boolean(active?.sessionId) && (active?.messagesQuery.isLoading ?? false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Root
        className="flex flex-1 flex-col bg-background text-sm min-h-0"
        style={THREAD_STYLE}
      >
        <ThreadPrimitive.Viewport
          turnAnchor="top"
          className="relative flex flex-1 flex-col overflow-y-auto scroll-smooth px-4"
          data-testid="agents-thread-viewport"
        >
          <InlineHeader session={session} status={status} error={error} />

          {isLoadingHistory ? (
            <LoadingHistory />
          ) : (
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <ThreadWelcome session={session} />
            </AuiIf>
          )}

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              EditComposer,
              AssistantMessage,
            }}
          />

          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-3 overflow-visible rounded-t-3xl bg-background pb-4">
            <ThreadScrollToBottom />
            <Composer session={session} status={status} />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

/**
 * Sticky inline header — pinned to the top of the message column,
 * showing the session's live status dot and title. Mirrors the example
 * UI's in-column header rather than a full-width top bar.
 */
function InlineHeader({
  session,
  status,
  error,
}: {
  session: AgentSession;
  status: 'connecting' | 'streaming' | 'idle' | 'error';
  error?: string;
}): React.ReactElement {
  return (
    <header className="sticky top-0 z-10 mx-auto flex w-full max-w-[var(--thread-max-width)] items-center gap-2 bg-background/90 px-2 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <StatusDot status={streamStatusToDot(status)} />
      <h1 className="truncate text-sm font-semibold tracking-tight">{session.title}</h1>
      {status === 'error' && error ? (
        <span className="ml-auto truncate text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </header>
  );
}

// ─── Welcome / loading ──────────────────────────────────────────────────

function LoadingHistory(): React.ReactElement {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      <LoaderIcon className="size-4 animate-spin mr-2" />
      Loading history…
    </div>
  );
}

function ThreadWelcome({ session }: { session: AgentSession }): React.ReactElement {
  return (
    <div className="mx-auto my-auto flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
      <div className="flex w-full flex-grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-2">
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-primary" />
            <span className="text-2xl font-semibold text-foreground">{session.title}</span>
          </div>
          <div className="text-2xl text-muted-foreground/70 mt-1">What should we work on?</div>
        </div>
      </div>
      <div className="grid w-full gap-2 pb-4 md:grid-cols-2">
        <SuggestionCard
          title="Summarize this workspace"
          subtitle="List the top-level packages and what each does"
          prompt="Give me a tour of this workspace. List the top-level packages and briefly describe what each does."
        />
        <SuggestionCard
          title="Find a bug"
          subtitle="Look for likely issues in recently changed files"
          prompt="Look at the recently changed files. Are there any obvious bugs, missing error handling, or subtle issues?"
        />
        <SuggestionCard
          title="Write a test"
          subtitle="Pick an untested function and add a unit test"
          prompt="Find an untested function in this workspace and write a focused unit test for it."
        />
        <SuggestionCard
          title="Refactor for clarity"
          subtitle="Suggest small improvements to readability"
          prompt="Pick a file that looks complex and suggest a small refactor that improves readability without changing behavior."
        />
      </div>
    </div>
  );
}

function SuggestionCard({
  title,
  subtitle,
  prompt,
}: {
  title: string;
  subtitle: string;
  prompt: string;
}): React.ReactElement {
  return (
    <ThreadPrimitive.Suggestion prompt={prompt} method="replace" autoSend asChild>
      <button
        type="button"
        className="flex h-auto w-full flex-col items-start justify-start gap-1 rounded-2xl border border-border bg-card px-5 py-4 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-muted-foreground">{subtitle}</span>
      </button>
    </ThreadPrimitive.Suggestion>
  );
}

// ─── Composer ───────────────────────────────────────────────────────────

function Composer({
  session,
  status,
}: {
  session: AgentSession;
  status: 'connecting' | 'streaming' | 'idle' | 'error';
}): React.ReactElement {
  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col" data-testid="agents-composer">
      <ComposerPrimitive.AttachmentDropzone className="flex w-full flex-col rounded-2xl border border-border bg-card px-1 pt-2 outline-none transition-shadow has-[textarea:focus-visible]:border-primary/60 data-[dragging=true]:border-primary data-[dragging=true]:border-dashed data-[dragging=true]:bg-primary/5">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          placeholder="Send a message…"
          className="mb-1 max-h-40 min-h-14 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
          data-testid="agents-composer-input"
        />
        <ComposerAction session={session} status={status} />
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
}

function ComposerAction({
  session,
  status,
}: {
  session: AgentSession;
  status: 'connecting' | 'streaming' | 'idle' | 'error';
}): React.ReactElement {
  const updateSession = useUpdateSession();

  const handleModelChange = React.useCallback(
    (next: ModelSelection) => {
      updateSession.mutate({
        id: session.id,
        input: { providerId: next.providerId, model: next.model },
      });
    },
    [session.id, updateSession],
  );

  return (
    <div className="relative mx-2 mb-2 flex items-center gap-2">
      <ComposerAddAttachment />

      <ModelSelector
        providerId={session.providerId}
        model={session.model}
        onChange={handleModelChange}
        menuPlacement="top"
        disabled={updateSession.isPending || status === 'streaming'}
      />

      <div className="ml-auto" />

      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            variant="default"
            size="icon"
            className="size-8 rounded-full"
            data-testid="agents-composer-send"
          >
            <ArrowUpIcon className="size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>

      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <TooltipIconButton
            tooltip="Stop generating"
            variant="default"
            size="icon"
            className="size-8 rounded-full bg-destructive text-destructive-foreground"
            data-testid="agents-composer-cancel"
          >
            <SquareIcon className="size-3 fill-current" />
          </TooltipIconButton>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
}

function ThreadScrollToBottom(): React.ReactElement {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
}

// ─── Messages ───────────────────────────────────────────────────────────

function UserMessage(): React.ReactElement {
  return (
    <MessagePrimitive.Root
      className="mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 fade-in slide-in-from-bottom-1 animate-in duration-150"
      data-role="user"
      data-testid="agents-message-user"
    >
      <UserMessageAttachments />

      <div className="relative col-start-2 min-w-0 flex items-start gap-2">
        <div className="rounded-lg bg-secondary text-secondary-foreground px-4 py-2.5 break-words text-sm whitespace-pre-wrap">
          <MessagePrimitive.Parts />
        </div>
        <Avatar role="user" />
        <div className="absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className="col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
}

function UserActionBar(): React.ReactElement {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
}

function EditComposer(): React.ReactElement {
  return (
    <MessagePrimitive.Root className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col px-2 py-3">
      <ComposerPrimitive.Root className="ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted/40 border border-border">
        <ComposerPrimitive.Input
          className="min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60"
            >
              Cancel
            </button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Update
            </button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

const TOOL_COMPONENTS: Record<string, ToolCallMessagePartComponent> = {
  [FLOWLIB_TOOL_NAMES.fileEdit]: ({ args }) => <FileDiffViewer event={args as FileEditEvent} />,
  [FLOWLIB_TOOL_NAMES.permission]: ({ args }) => (
    <PermissionPart event={args as PermissionRequestEvent} />
  ),
  [FLOWLIB_TOOL_NAMES.humanInput]: ({ args }) => (
    <HumanInputPart event={args as HumanInputRequestEvent} />
  ),
};

function AssistantMessage(): React.ReactElement {
  return (
    <MessagePrimitive.Root
      className="relative mx-auto w-full max-w-[var(--thread-max-width)] py-3 fade-in slide-in-from-bottom-1 animate-in duration-150"
      data-role="assistant"
      data-testid="agents-message-assistant"
    >
      <div className="flex gap-3 px-2">
        <Avatar role="assistant" />
        <div className="min-w-0 flex-1 break-words leading-relaxed text-foreground space-y-2">
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              tools: { by_name: TOOL_COMPONENTS, Fallback: ToolFallback },
            }}
          />
          <MessageError />
          <AuiIf condition={(s) => s.thread.isRunning && s.message.content.length === 0}>
            <div className="flex items-center gap-2 text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
              <span className="text-sm">Thinking…</span>
            </div>
          </AuiIf>
        </div>
      </div>

      <div className="mt-1 ml-12 flex min-h-6 items-center">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
}

function MessageError(): React.ReactElement {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
        <ErrorPrimitive.Message className="line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
}

function AssistantActionBar(): React.ReactElement {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="-ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" size="sm">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.ExportMarkdown asChild>
        <TooltipIconButton tooltip="Export as Markdown" size="sm">
          <DownloadIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.ExportMarkdown>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate" size="sm">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function BranchPicker({ className }: { className?: string }): React.ReactElement {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn('mr-2 -ml-2 inline-flex items-center text-xs text-muted-foreground', className)}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous" size="sm">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium tabular-nums px-1">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next" size="sm">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

// ─── FLOWLIB tool-call parts ────────────────────────────────────────────

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

// ─── Misc ───────────────────────────────────────────────────────────────

function Avatar({ role }: { role: 'user' | 'assistant' }): React.ReactElement {
  return (
    <div
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-medium',
        role === 'user' ? 'bg-secondary text-secondary-foreground' : 'bg-primary/15 text-primary',
      )}
      aria-hidden="true"
    >
      {role === 'user' ? 'You' : <Sparkles className="size-4" />}
    </div>
  );
}
