/**
 * `createScriptedProvider` — a deterministic `AgentProvider` that yields a
 * scripted sequence of `AgentEvent`s. No network, no API key.
 *
 * This is the backbone of the harness's own test suite: it lets us verify
 * the transcript, scorers, and report wiring without a live model. It also
 * doubles as a fast way to smoke-test new scorers.
 *
 * A script is either a fixed event array or a function of the prompt text,
 * so a single provider can branch on what the "agent" was asked.
 */

import type { AgentEvent } from '../../../src/shared/events';
import type {
  AgentProvider,
  AgentProviderConfig,
  CreateSessionInput,
  PromptInput,
} from '../../../src/backend/providers/types';

/** A script: fixed events, or a function of the incoming prompt text. */
export type Script =
  | AgentEvent[]
  | ((promptText: string, input: PromptInput) => AgentEvent[] | Promise<AgentEvent[]>);

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `eval-msg-${messageCounter}`;
}

/**
 * Build a turn's worth of events from a simpler step description — the
 * ergonomic way to author scripts. Auto-assigns a messageId and emits a
 * trailing `message-complete` + `session-end`.
 */
export function scriptTurn(steps: {
  /** Assistant text to stream (as one delta). */
  text?: string;
  /** Tool calls to emit, each with the result the "agent" got back. */
  tools?: Array<{ name: string; input?: unknown; output?: unknown; isError?: boolean }>;
  /** File edits to emit. */
  fileEdits?: Array<{ path: string; before?: string; after?: string }>;
  /** Override the end reason (default `completed`). */
  endReason?: 'completed' | 'stopped' | 'max-turns' | 'error';
  /** Reported token usage. */
  usage?: { inputTokens: number; outputTokens: number };
}): AgentEvent[] {
  const messageId = nextMessageId();
  const events: AgentEvent[] = [];
  if (steps.text) {
    events.push({ type: 'text-delta', messageId, text: steps.text });
  }
  let callSeq = 0;
  for (const tool of steps.tools ?? []) {
    const id = `${messageId}-call-${callSeq++}`;
    events.push({ type: 'tool-call', messageId, id, name: tool.name, input: tool.input ?? {} });
    events.push({
      type: 'tool-result',
      messageId,
      id,
      output: tool.output ?? { ok: true },
      ...(tool.isError ? { isError: true } : {}),
    });
  }
  for (const edit of steps.fileEdits ?? []) {
    events.push({
      type: 'file-edit',
      messageId,
      path: edit.path,
      ...(edit.before !== undefined ? { before: edit.before } : {}),
      ...(edit.after !== undefined ? { after: edit.after } : {}),
    });
  }
  events.push({
    type: 'message-complete',
    messageId,
    ...(steps.usage ? { usage: steps.usage } : {}),
  });
  events.push({ type: 'session-end', reason: steps.endReason ?? 'completed' });
  return events;
}

const CAPABILITIES = {
  streaming: true,
  toolUse: true,
  mcpServers: false,
  parallelToolCalls: true,
  fileEdits: true,
  resumableStream: false,
  workspaceRequired: false,
  permissionPrompts: false,
} as const;

/** Create a scripted provider from a {@link Script}. */
export function createScriptedProvider(script: Script): AgentProvider {
  return {
    id: 'scripted',
    name: 'Scripted (eval)',
    defaultModel: 'scripted/deterministic',
    capabilities: CAPABILITIES,

    validateConfig(config: unknown): AgentProviderConfig {
      return (config ?? {}) as AgentProviderConfig;
    },

    async createSession(input: CreateSessionInput): Promise<{ providerSessionId: string }> {
      return { providerSessionId: input.providerSessionId ?? `scripted-${Date.now()}` };
    },

    async *prompt(input: PromptInput): AsyncGenerator<AgentEvent, void, void> {
      const promptText = input.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const events = typeof script === 'function' ? await script(promptText, input) : script;
      for (const event of events) {
        if (input.abortSignal.aborted) {
          yield { type: 'session-end', reason: 'stopped' };
          return;
        }
        yield event;
      }
    },
  };
}
