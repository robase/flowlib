/**
 * `runTurn` — the kernel's orchestration loop.
 *
 * Pure function: takes a `SessionContext` + `PromptInput`, drains the
 * provider's `AsyncIterable<AgentEvent>`, applies the hook pipeline,
 * fires persistence callbacks at well-known boundaries, and forwards
 * each event to `ctx.emit`.
 *
 * Provider-agnostic — never imports anything from the agents tables /
 * repositories. The kernel knows about `SessionContext` only.
 *
 * Stream A (this file) is the only place the loop logic lives. Stream H
 * (Cloudflare DO) and Stream I (REST endpoints) call into this through
 * `AgentService.runTurn`; they don't roll their own loops.
 */

import type { AgentEvent, ToolResultEvent } from '../../shared/events';
import type { PromptInput } from '../providers/types';
import type { SessionContext, RunResult, PersistenceCallbacks } from './types';
import type { HookDecision, PostHookDecision } from '../hooks/types';

/**
 * The reason we surface as the turn's end state. Mirrors
 * `RunResult.reason` and `SessionEndEvent.reason`.
 */
type EndReason = 'stopped' | 'max-turns' | 'error' | 'completed';

/**
 * Key under which the kernel threads its {@link ToolGuard} onto
 * `PromptInput.extras`.
 *
 * Why a guard exists at all: for providers that own tool dispatch
 * themselves (the ai-sdk provider hands `execute` callbacks to
 * `streamText`), the `tool-call` event this loop observes is a
 * *notification emitted alongside execution*, not a request for
 * permission. Running `runPreToolUse` here and emitting a synthetic
 * "blocked" result is then purely advisory theatre — `rm -rf /` has
 * already run in the container by the time the user reads "Blocked".
 *
 * So the deny/modify decision is exposed as a callable the provider
 * invokes *inside* its tool wrapper, before the underlying execute. The
 * decision is memoised per tool-call id, so whichever side asks first
 * (the guard at execute-time, or this loop at event-time) runs the hook
 * chain exactly once and both see the same answer — no duplicate audit
 * rows, no double-emitted blocked results.
 *
 * Providers that don't dispatch tools themselves (opencode, claude-code)
 * simply ignore `extras` and keep the event-time behaviour.
 */
export const TOOL_GUARD_EXTRA_KEY = '__flowlibToolGuard';

/** Outcome of a {@link ToolGuard.check}. */
export interface ToolGuardDecision {
  /** `false` ⇒ the provider MUST NOT run the underlying tool. */
  allow: boolean;
  /** Human-readable block reason — surfaced to the model as the tool result. */
  reason?: string;
  /** The input to execute with: `modifiedInput` when a hook rewrote it, else the original. */
  input: Record<string, unknown>;
}

/**
 * The pre-execution gate a tool-dispatching provider must consult before
 * invoking a tool's underlying `execute`. See {@link TOOL_GUARD_EXTRA_KEY}.
 */
export interface ToolGuard {
  check(args: {
    /** Canonical (pre-sanitisation) tool name, e.g. `sandbox.run_shell`. */
    toolName: string;
    /** The AI SDK's tool-call id. Omitted ⇒ the decision can't be memoised. */
    toolCallId?: string;
    input: Record<string, unknown>;
  }): Promise<ToolGuardDecision>;
}

/**
 * Best-effort persistence — swallows + logs callback errors so a
 * misbehaving persistence layer never aborts the stream. The kernel's
 * job is to keep events flowing.
 */
async function safeCallback(
  ctx: SessionContext,
  label: keyof PersistenceCallbacks,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    ctx.logger.warn(`[agents] persistence callback "${label}" threw`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Best-effort emit — same rationale as `safeCallback`. A WebSocket
 * write that fails shouldn't take down the loop; we just log and keep
 * draining.
 */
async function safeEmit(ctx: SessionContext, event: AgentEvent): Promise<void> {
  try {
    await ctx.emit(event);
  } catch (err) {
    ctx.logger.warn('[agents] emit threw', {
      error: err instanceof Error ? err.message : String(err),
      type: event.type,
    });
  }
}

/**
 * Drain the provider iterator and run the loop.
 */
export async function runTurn(ctx: SessionContext, prompt: PromptInput): Promise<RunResult> {
  const startedAt = Date.now();

  // Loop-local state ─────────────────────────────────────────────────
  // Track which messageIds we've already announced via onMessageStart
  // so the kernel handles the boundary without provider help.
  const announcedMessages = new Set<string>();
  // Tool calls we let through, keyed by tool-call id, with the resolved
  // (post pre-hook) input + name. The post-hook context needs both.
  const liveToolCalls = new Map<string, { name: string; input: unknown }>();
  // Tool calls the pre-hook blocked. We've already emitted a synthetic
  // tool-result for these; suppress the provider's real one when it
  // arrives (providers may still produce one for symmetry).
  const blockedToolCallIds = new Set<string>();

  let iteration = 0;

  // ─── Pre-tool decisions (memoised) ───────────────────────────────
  // One decision per tool-call id, shared between the guard (asked by
  // tool-dispatching providers *before* execute) and the `tool-call`
  // event branch below. Whoever asks first computes; the other reuses.
  // In-flight promises are tracked so two concurrent asks for the same
  // id can't both run the hook chain.
  const preDecisions = new Map<string, HookDecision<unknown>>();
  const preDecisionsInFlight = new Map<string, Promise<HookDecision<unknown>>>();

  async function decidePreToolUse(args: {
    toolName: string;
    toolCallId: string;
    input: unknown;
  }): Promise<HookDecision<unknown>> {
    const cached = preDecisions.get(args.toolCallId);
    if (cached) {
      return cached;
    }
    const pending = preDecisionsInFlight.get(args.toolCallId);
    if (pending) {
      return pending;
    }

    const run = (async (): Promise<HookDecision<unknown>> => {
      // The iteration counter advances once per *distinct* tool call,
      // whichever side observes it first.
      iteration++;
      try {
        return await ctx.hooks.runPreToolUse({
          sessionId: ctx.sessionId,
          auth: ctx.auth,
          toolName: args.toolName,
          toolCallId: args.toolCallId,
          iteration,
          input: args.input,
        });
      } catch (err) {
        // Fail-open on a pipeline throw, matching the pre-existing
        // contract (individual handlers already fail-open in
        // `createHookPipeline`).
        ctx.logger.error('[agents] pre-tool-use hook threw', {
          error: err instanceof Error ? err.message : String(err),
          tool: args.toolName,
        });
        return { continue: true };
      }
    })();

    preDecisionsInFlight.set(args.toolCallId, run);
    try {
      const decision = await run;
      preDecisions.set(args.toolCallId, decision);
      return decision;
    } finally {
      preDecisionsInFlight.delete(args.toolCallId);
    }
  }

  /**
   * The gate handed to tool-dispatching providers. A `false` here MUST
   * stop the tool from running — that's the whole point of the seam.
   */
  let unmemoisedGuardSeq = 0;
  const toolGuard: ToolGuard = {
    async check({ toolName, toolCallId, input }) {
      // Without a tool-call id we can't memoise against the event-time
      // path — run the hooks anyway. A possible duplicate hook run is
      // strictly better than an unguarded execute.
      const id = toolCallId ?? `guard-unmemoised-${++unmemoisedGuardSeq}`;
      const decision = await decidePreToolUse({ toolName, toolCallId: id, input });
      const resolved = (
        decision.modifiedInput !== undefined ? decision.modifiedInput : input
      ) as Record<string, unknown>;
      if (decision.terminate) {
        return {
          allow: false,
          reason: decision.reason ?? 'terminated by pre-tool hook',
          input: resolved,
        };
      }
      if (decision.continue === false) {
        return {
          allow: false,
          reason: decision.reason ?? 'blocked by pre-tool hook',
          input: resolved,
        };
      }
      return { allow: true, input: resolved };
    },
  };

  const promptWithGuard: PromptInput = {
    ...prompt,
    extras: { ...prompt.extras, [TOOL_GUARD_EXTRA_KEY]: toolGuard },
  };

  let messageCount = 0;
  let toolCallCount = 0;
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;

  let endReason: EndReason = 'completed';
  let endError: string | undefined;
  let providerEmittedSessionEnd = false;
  // True once the loop should exit promptly — after the current event
  // finishes processing — without consuming further provider events.
  let stopRequested = false;

  // ─── Abort wiring ────────────────────────────────────────────────
  // If `ctx.abortSignal` fires, flag stop and let the loop drop out at
  // its next iteration. We don't break iterators forcibly here — the
  // provider must honour `prompt.abortSignal` (which is the same signal
  // — see Stream I) and yield no further events. If a misbehaving
  // provider keeps yielding, the `if (stopRequested) break` guard
  // catches it.
  if (ctx.abortSignal.aborted) {
    stopRequested = true;
    endReason = 'stopped';
  }

  const onAbort = () => {
    stopRequested = true;
    if (endReason === 'completed') {
      endReason = 'stopped';
    }
  };

  if (!ctx.abortSignal.aborted) {
    ctx.abortSignal.addEventListener('abort', onAbort, { once: true });
  }

  // ─── Drain the provider stream ───────────────────────────────────
  let iterator: AsyncIterable<AgentEvent> | undefined;
  try {
    iterator = ctx.provider.prompt(promptWithGuard);
  } catch (err) {
    endReason = 'error';
    endError = err instanceof Error ? err.message : String(err);
  }

  if (iterator) {
    try {
      for await (const event of iterator) {
        if (stopRequested) {
          break;
        }

        switch (event.type) {
          case 'text-delta': {
            if (!announcedMessages.has(event.messageId)) {
              announcedMessages.add(event.messageId);
              messageCount++;
              await safeCallback(ctx, 'onMessageStart', () =>
                ctx.callbacks.onMessageStart({
                  messageId: event.messageId,
                  role: 'assistant',
                }),
              );
            }
            await safeCallback(ctx, 'onTextDelta', () =>
              ctx.callbacks.onTextDelta({
                messageId: event.messageId,
                text: event.text,
              }),
            );
            await safeEmit(ctx, event);
            break;
          }

          case 'tool-call': {
            toolCallCount++;

            // Memoised: if the provider already consulted the guard for
            // this id (i.e. it gated its own dispatch), we reuse that
            // decision rather than re-running the hook chain — the tool
            // has already been allowed/denied on the basis of it.
            // Otherwise this is the first look at the call and we decide
            // here, exactly as before.
            const decision = await decidePreToolUse({
              toolName: event.name,
              toolCallId: event.id,
              input: event.input,
            });

            const resolvedInput =
              decision.modifiedInput !== undefined ? decision.modifiedInput : event.input;

            if (decision.terminate) {
              // Hard kill. Persist the (modified) call, then a
              // synthetic error tool-result, then bail with reason
              // 'error'.
              await safeCallback(ctx, 'onToolCall', () =>
                ctx.callbacks.onToolCall({
                  messageId: event.messageId,
                  id: event.id,
                  name: event.name,
                  input: resolvedInput,
                }),
              );
              await safeEmit(ctx, { ...event, input: resolvedInput });

              const errorMessage = decision.reason ?? 'terminated by pre-tool hook';
              const synthetic: ToolResultEvent = {
                type: 'tool-result',
                messageId: event.messageId,
                id: event.id,
                output: { error: errorMessage },
                isError: true,
              };
              await safeCallback(ctx, 'onToolResult', () =>
                ctx.callbacks.onToolResult({
                  messageId: synthetic.messageId,
                  id: synthetic.id,
                  output: synthetic.output,
                  isError: true,
                }),
              );
              await safeEmit(ctx, synthetic);

              endReason = 'error';
              endError = errorMessage;
              stopRequested = true;
              break;
            }

            if (decision.continue === false) {
              // Soft block — record the call (so audit trail shows
              // what was attempted), emit a synthetic blocked
              // tool-result, suppress the provider's real one.
              blockedToolCallIds.add(event.id);
              await safeCallback(ctx, 'onToolCall', () =>
                ctx.callbacks.onToolCall({
                  messageId: event.messageId,
                  id: event.id,
                  name: event.name,
                  input: resolvedInput,
                }),
              );
              await safeEmit(ctx, { ...event, input: resolvedInput });

              const synthetic: ToolResultEvent = {
                type: 'tool-result',
                messageId: event.messageId,
                id: event.id,
                output: { error: decision.reason ?? 'blocked by pre-tool hook' },
                isError: true,
              };
              await safeCallback(ctx, 'onToolResult', () =>
                ctx.callbacks.onToolResult({
                  messageId: synthetic.messageId,
                  id: synthetic.id,
                  output: synthetic.output,
                  isError: true,
                }),
              );
              await safeEmit(ctx, synthetic);
              break;
            }

            // Allowed — track it for the matching post-hook.
            liveToolCalls.set(event.id, {
              name: event.name,
              input: resolvedInput,
            });
            await safeCallback(ctx, 'onToolCall', () =>
              ctx.callbacks.onToolCall({
                messageId: event.messageId,
                id: event.id,
                name: event.name,
                input: resolvedInput,
              }),
            );
            await safeEmit(ctx, { ...event, input: resolvedInput });
            break;
          }

          case 'tool-result': {
            if (blockedToolCallIds.has(event.id)) {
              // Provider produced a real result for a call we
              // already synthetically blocked — drop it on the floor.
              break;
            }

            const tracked = liveToolCalls.get(event.id);
            const toolName = tracked?.name ?? 'unknown';
            const toolInput = tracked?.input;

            let postDecision: PostHookDecision<unknown>;
            try {
              postDecision = await ctx.hooks.runPostToolUse({
                sessionId: ctx.sessionId,
                auth: ctx.auth,
                toolName,
                toolCallId: event.id,
                iteration,
                input: toolInput,
                output: event.output,
                isError: event.isError ?? false,
              });
            } catch (err) {
              ctx.logger.error('[agents] post-tool-use hook threw', {
                error: err instanceof Error ? err.message : String(err),
                tool: toolName,
              });
              postDecision = { continue: true };
            }

            const finalOutput =
              postDecision.modifiedOutput !== undefined
                ? postDecision.modifiedOutput
                : event.output;

            // `continue: false` here doesn't suppress the result —
            // the tool already ran. We mark it as an error so the
            // model sees the blocked outcome.
            const isError = postDecision.continue === false ? true : (event.isError ?? false);

            const finalEvent: ToolResultEvent = {
              type: 'tool-result',
              messageId: event.messageId,
              id: event.id,
              output: finalOutput,
              isError,
            };

            await safeCallback(ctx, 'onToolResult', () =>
              ctx.callbacks.onToolResult({
                messageId: finalEvent.messageId,
                id: finalEvent.id,
                output: finalOutput,
                isError,
              }),
            );
            await safeEmit(ctx, finalEvent);

            liveToolCalls.delete(event.id);

            if (postDecision.terminate) {
              endReason = 'error';
              endError = postDecision.reason ?? 'terminated by post-tool hook';
              stopRequested = true;
            }
            break;
          }

          case 'file-edit': {
            await safeCallback(ctx, 'onFileEdit', () =>
              ctx.callbacks.onFileEdit({
                messageId: event.messageId,
                path: event.path,
                before: event.before,
                after: event.after,
              }),
            );
            await safeEmit(ctx, event);
            break;
          }

          case 'message-complete': {
            if (event.usage) {
              inputTokensTotal += event.usage.inputTokens ?? 0;
              outputTokensTotal += event.usage.outputTokens ?? 0;
            }
            await safeCallback(ctx, 'onMessageComplete', () =>
              ctx.callbacks.onMessageComplete({
                messageId: event.messageId,
                usage: event.usage,
              }),
            );
            await safeEmit(ctx, event);
            break;
          }

          case 'session-end': {
            providerEmittedSessionEnd = true;
            // Provider-supplied reason wins unless we've already
            // decided we're erroring/stopping.
            if (endReason === 'completed') {
              endReason = event.reason;
              endError = event.error;
            }
            await safeEmit(ctx, event);
            stopRequested = true;
            break;
          }

          // permission-request / human-input-request: pass-through.
          // Stream J / HIL handle the response loop above the kernel.
          case 'permission-request':
          case 'human-input-request':
          default: {
            await safeEmit(ctx, event);
            break;
          }
        }

        if (stopRequested) {
          break;
        }
      }
    } catch (err) {
      endReason = 'error';
      endError = err instanceof Error ? err.message : String(err);
    }
  }

  // Abort might have fired while we were inside a callback — re-check.
  if (ctx.abortSignal.aborted && endReason === 'completed') {
    endReason = 'stopped';
  }

  ctx.abortSignal.removeEventListener('abort', onAbort);

  // ─── Closing ─────────────────────────────────────────────────────
  await safeCallback(ctx, 'onTurnEnd', () =>
    ctx.callbacks.onTurnEnd({ reason: endReason, error: endError }),
  );

  if (!providerEmittedSessionEnd) {
    await safeEmit(ctx, {
      type: 'session-end',
      reason: endReason,
      error: endError,
    });
  }

  return {
    reason: endReason,
    messageCount,
    toolCallCount,
    inputTokensTotal,
    outputTokensTotal,
    durationMs: Date.now() - startedAt,
    error: endError,
  };
}
