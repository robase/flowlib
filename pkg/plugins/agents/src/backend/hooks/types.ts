/**
 * Hook pipeline types — used by Stream S1 (Phase 3) for security hardening
 * (sensitive-path denies, secret redaction, dangerous-bash blocks). v1
 * stubs here so other streams can build against the surface without
 * waiting for S1.
 */

import type { AgentsAuthContext } from '../../shared/auth-context';

/**
 * Decision returned by a hook handler.
 *
 * - `continue: false` blocks the operation hard. Optional `reason`
 *   surfaces in the audit log.
 * - `modifiedInput` rewrites the tool input before execution.
 * - `terminate: true` ends the entire session, not just the call.
 */
export interface HookDecision<TInput = unknown> {
  continue?: boolean;
  reason?: string;
  modifiedInput?: TInput;
  terminate?: boolean;
}

/**
 * Context passed to a `PreToolUse` hook handler.
 */
export interface PreToolUseContext<TInput = unknown> {
  sessionId: string;
  auth: AgentsAuthContext;
  toolName: string;
  toolCallId: string;
  /** Iteration number within the agent loop (1-indexed). */
  iteration: number;
  input: TInput;
}

/**
 * Context passed to a `PostToolUse` hook handler. Carries the (possibly
 * truncated) output the agent will see.
 */
export interface PostToolUseContext<TInput = unknown, TOutput = unknown> {
  sessionId: string;
  auth: AgentsAuthContext;
  toolName: string;
  toolCallId: string;
  iteration: number;
  input: TInput;
  output: TOutput;
  isError: boolean;
}

/**
 * Decision returned by a `PostToolUse` hook. Same shape as
 * `HookDecision` but `modifiedOutput` is the relevant field.
 */
export interface PostHookDecision<TOutput = unknown> {
  continue?: boolean;
  reason?: string;
  modifiedOutput?: TOutput;
  terminate?: boolean;
}

/** A single PreToolUse handler. */
export type PreToolUseHook<TInput = unknown> = (
  ctx: PreToolUseContext<TInput>,
) => Promise<HookDecision<TInput> | void>;

/** A single PostToolUse handler. */
export type PostToolUseHook<TInput = unknown, TOutput = unknown> = (
  ctx: PostToolUseContext<TInput, TOutput>,
) => Promise<PostHookDecision<TOutput> | void>;

/**
 * The composed hook pipeline. Stream A calls `runPreToolUse` /
 * `runPostToolUse` at the appropriate points.
 *
 * Implementations may chain multiple handlers; the first one that
 * returns `continue: false` short-circuits the chain.
 */
export interface HookPipeline {
  /**
   * Run all PreToolUse handlers. Returns the (possibly modified)
   * input or a hard-block decision.
   */
  runPreToolUse<TInput>(ctx: PreToolUseContext<TInput>): Promise<HookDecision<TInput>>;
  /**
   * Run all PostToolUse handlers. Returns the (possibly modified)
   * output or a hard-block decision.
   */
  runPostToolUse<TInput, TOutput>(
    ctx: PostToolUseContext<TInput, TOutput>,
  ): Promise<PostHookDecision<TOutput>>;
}

/**
 * Empty / no-op pipeline — used by Stream P0 stubs and as the default
 * when no security plugins are wired in.
 */
export const noopHookPipeline: HookPipeline = {
  async runPreToolUse() {
    return { continue: true };
  },
  async runPostToolUse() {
    return { continue: true };
  },
};
