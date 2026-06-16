/**
 * `Transcript` — a structured view over the `AgentEvent` stream a turn
 * emits. Scorers read this instead of walking raw events.
 */

import type {
  AgentEvent,
  FileEditEvent,
  HumanInputRequestEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../../src/shared/events';

/** A tool call paired with its result (when one arrived). */
export interface ToolInvocation {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

/**
 * Collects events as they're emitted and exposes the shapes scorers need:
 * final assistant text, the ordered tool calls, file edits, and so on.
 */
export class Transcript {
  readonly events: AgentEvent[] = [];

  /** Push one event (the harness wires this as the kernel's `emit` sink). */
  record(event: AgentEvent): void {
    this.events.push(event);
  }

  /** All assistant text, concatenated in stream order. */
  get text(): string {
    return this.events
      .filter((e): e is Extract<AgentEvent, { type: 'text-delta' }> => e.type === 'text-delta')
      .map((e) => e.text)
      .join('');
  }

  /** Tool-call events in order. */
  get toolCalls(): ToolCallEvent[] {
    return this.events.filter((e): e is ToolCallEvent => e.type === 'tool-call');
  }

  /** Tool-result events in order. */
  get toolResults(): ToolResultEvent[] {
    return this.events.filter((e): e is ToolResultEvent => e.type === 'tool-result');
  }

  /** File-edit events in order. */
  get fileEdits(): FileEditEvent[] {
    return this.events.filter((e): e is FileEditEvent => e.type === 'file-edit');
  }

  /** Human-input requests (e.g. the `ask_user` tool blocking). */
  get humanInputRequests(): HumanInputRequestEvent[] {
    return this.events.filter(
      (e): e is HumanInputRequestEvent => e.type === 'human-input-request',
    );
  }

  /** Tool calls joined to their results by id, in call order. */
  get invocations(): ToolInvocation[] {
    const resultsById = new Map<string, ToolResultEvent>();
    for (const r of this.toolResults) {
      resultsById.set(r.id, r);
    }
    return this.toolCalls.map((call) => {
      const result = resultsById.get(call.id);
      return {
        id: call.id,
        name: call.name,
        input: call.input,
        output: result?.output,
        isError: result?.isError,
      };
    });
  }

  /** Unique tool names invoked this turn. */
  get toolNames(): string[] {
    return [...new Set(this.toolCalls.map((c) => c.name))];
  }

  /** How the turn ended, per the (provider or kernel) session-end event. */
  get endReason(): 'stopped' | 'max-turns' | 'error' | 'completed' | undefined {
    const end = [...this.events].reverse().find((e) => e.type === 'session-end');
    return end?.type === 'session-end' ? end.reason : undefined;
  }

  /** Did the agent call `name` at least once? Matches dotted or sanitised form. */
  usedTool(name: string): boolean {
    const wanted = normaliseToolName(name);
    return this.toolCalls.some((c) => normaliseToolName(c.name) === wanted);
  }

  /** Index of the first call to `name`, or -1. */
  firstCallIndex(name: string): number {
    const wanted = normaliseToolName(name);
    return this.toolCalls.findIndex((c) => normaliseToolName(c.name) === wanted);
  }
}

/**
 * Tool names cross the wire sanitised (`sandbox.grep` → `sandbox_grep`).
 * Compare on a canonical form so scorers can use the natural dotted id.
 */
export function normaliseToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}
