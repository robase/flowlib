/**
 * Hook pipeline — chains the security handlers and emits audit events.
 *
 * Implements the `HookPipeline` the kernel (`run-turn.ts`) already calls:
 *   - `runPreToolUse`  — runs PreToolUse handlers in order; the first that
 *     returns `continue: false` or `terminate` short-circuits. `modifiedInput`
 *     threads through to later handlers and into the returned decision.
 *   - `runPostToolUse` — same for PostToolUse handlers; `modifiedOutput`
 *     (e.g. secret redaction) threads through.
 *
 * Any `audit` a handler attaches is written via the supplied
 * `AuditWriter` (best-effort, fire-and-forget). A handler that throws is
 * logged and skipped (fail-open per-handler so one buggy handler can't
 * brick every tool call; the kernel also fail-opens on a pipeline throw).
 * Failing closed for security handlers is a configurable follow-up.
 */

import type { AuditWriter } from '../audit/writer';
import type { SecurityPostHandler, SecurityPreHandler } from './handlers';
import type {
  HookDecision,
  HookPipeline,
  PostHookDecision,
  PostToolUseContext,
  PreToolUseContext,
} from './types';

export interface CreateHookPipelineDeps {
  pre?: ReadonlyArray<SecurityPreHandler>;
  post?: ReadonlyArray<SecurityPostHandler>;
  /** Where audit events go. The registry's writer is a no-op until a DB-bound one is wired. */
  audit?: AuditWriter;
  logger?: { warn(message: string, meta?: unknown): void };
}

export function createHookPipeline(deps: CreateHookPipelineDeps): HookPipeline {
  const pre = deps.pre ?? [];
  const post = deps.post ?? [];

  function emit(
    ctx: { sessionId: string; auth: { userId: string; orgId: string }; toolName: string },
    audit:
      | {
          eventType: Parameters<AuditWriter['write']>[0]['eventType'];
          payload?: Record<string, unknown>;
        }
      | undefined,
  ): void {
    if (!audit || !deps.audit) {
      return;
    }
    void deps.audit
      .write({
        sessionId: ctx.sessionId,
        userId: ctx.auth.userId,
        orgId: ctx.auth.orgId,
        eventType: audit.eventType,
        toolName: ctx.toolName,
        payload: audit.payload ?? {},
      })
      .catch(() => {
        /* audit failures never break the request path */
      });
  }

  return {
    async runPreToolUse<TInput>(ctx: PreToolUseContext<TInput>): Promise<HookDecision<TInput>> {
      let input = ctx.input;
      for (const handler of pre) {
        let decision;
        try {
          decision = await handler({ ...ctx, input });
        } catch (err) {
          deps.logger?.warn('[agents] pre-tool hook threw — skipping', {
            tool: ctx.toolName,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        if (!decision) {
          continue;
        }
        emit(ctx, decision.audit);
        if (decision.modifiedInput !== undefined) {
          input = decision.modifiedInput as TInput;
        }
        if (decision.terminate) {
          return { terminate: true, reason: decision.reason, modifiedInput: input };
        }
        if (decision.continue === false) {
          return { continue: false, reason: decision.reason, modifiedInput: input };
        }
      }
      return input === ctx.input ? { continue: true } : { continue: true, modifiedInput: input };
    },

    async runPostToolUse<TInput, TOutput>(
      ctx: PostToolUseContext<TInput, TOutput>,
    ): Promise<PostHookDecision<TOutput>> {
      let output = ctx.output;
      for (const handler of post) {
        let decision;
        try {
          decision = await handler({ ...ctx, output });
        } catch (err) {
          deps.logger?.warn('[agents] post-tool hook threw — skipping', {
            tool: ctx.toolName,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        if (!decision) {
          continue;
        }
        emit(ctx, decision.audit);
        if (decision.modifiedOutput !== undefined) {
          output = decision.modifiedOutput as TOutput;
        }
        if (decision.terminate) {
          return { terminate: true, reason: decision.reason, modifiedOutput: output };
        }
        if (decision.continue === false) {
          return { continue: false, reason: decision.reason, modifiedOutput: output };
        }
      }
      return output === ctx.output
        ? { continue: true }
        : { continue: true, modifiedOutput: output };
    },
  };
}
