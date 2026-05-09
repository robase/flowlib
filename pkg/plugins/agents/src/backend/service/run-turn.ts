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
import type {
  SessionContext,
  RunResult,
  PersistenceCallbacks,
} from './types';
import type {
  HookDecision,
  PostHookDecision,
} from '../hooks/types';

/**
 * The reason we surface as the turn's end state. Mirrors
 * `RunResult.reason` and `SessionEndEvent.reason`.
 */
type EndReason = 'stopped' | 'max-turns' | 'error' | 'completed';

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
async function safeEmit(
  ctx: SessionContext,
  event: AgentEvent,
): Promise<void> {
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
export async function runTurn(
  ctx: SessionContext,
  prompt: PromptInput,
): Promise<RunResult> {
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
    iterator = ctx.provider.prompt(prompt);
  } catch (err) {
    endReason = 'error';
    endError = err instanceof Error ? err.message : String(err);
  }

  if (iterator) {
    try {
      for await (const event of iterator) {
        if (stopRequested) {break;}

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
            iteration++;
            toolCallCount++;

            let decision: HookDecision<unknown>;
            try {
              decision = await ctx.hooks.runPreToolUse({
                sessionId: ctx.sessionId,
                auth: ctx.auth,
                toolName: event.name,
                toolCallId: event.id,
                iteration,
                input: event.input,
              });
            } catch (err) {
              ctx.logger.error('[agents] pre-tool-use hook threw', {
                error: err instanceof Error ? err.message : String(err),
                tool: event.name,
              });
              decision = { continue: true };
            }

            const resolvedInput =
              decision.modifiedInput !== undefined
                ? decision.modifiedInput
                : event.input;

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
            const isError =
              postDecision.continue === false
                ? true
                : (event.isError ?? false);

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

        if (stopRequested) {break;}
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
