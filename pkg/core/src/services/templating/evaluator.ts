/**
 * JsExpressionEvaluator — pluggable JS expression backend.
 *
 * Two implementations ship out of the box:
 *
 *   - QuickJsEvaluator (sandboxed, ~2 MB WASM, safe for multi-tenant hosts)
 *     — the default when running a fully managed server (Express/NestJS/Next.js).
 *
 *   - DirectEvaluator (`new Function` under the hood, no sandbox, trusted only)
 *     — for edge runtimes (Cloudflare Workers with `unsafe_eval`, Vercel
 *       Workflow steps) where bundling WASM is impractical and the flow
 *       author is the same party as the host.
 *
 * Consumers select an evaluator via FlowRunnerConfig (primitives) or
 * InvectConfig (server). Actions read it from `ctx.functions.evaluator`.
 */
import { JsExpressionEvaluationError, type JsExpressionEvaluator } from '@flowlib/action-kit';
export type { JsExpressionEvaluator };
export { JsExpressionEvaluationError };

/** Matches a valid JavaScript identifier (used to gate context-key destructuring). */
const VALID_JS_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Returns true if user code lacks a `return` keyword and should be auto-wrapped
 * as `return (<expression>)`. Strings and comments are stripped before matching
 * so `"return"` inside a string literal doesn't trigger a false positive.
 */
export function needsAutoReturn(code: string): boolean {
  let stripped = '';
  let i = 0;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < code.length && code[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
      const quote = code[i];
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') {
          i++;
        }
        i++;
      }
      i++;
      continue;
    }
    stripped += code[i];
    i++;
  }
  return !/\breturn\b/.test(stripped);
}

/**
 * Runtime feature check: is the `Function` constructor usable?
 *
 * Some edge runtimes (Cloudflare Workers without `unsafe_eval`, browsers with
 * strict CSP, Deno Deploy) throw when `new Function(...)` is called. Detect
 * this once at module load so callers don't have to. The probe is wrapped in
 * try/catch so module import never throws — the worst case is `HAS_EVAL`
 * resolves to `false` and `DirectEvaluator` falls back (or errors clearly)
 * when `evaluate()` is called.
 *
 * Exposed for tests and for hosts that want to log the runtime capability.
 */
export const HAS_EVAL: boolean = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function('return 1')();
    return true;
  } catch {
    return false;
  }
})();

/**
 * Constructor options for {@link DirectEvaluator}.
 */
export interface DirectEvaluatorOptions {
  /**
   * Force-disable the `new Function` fast path even when the runtime supports
   * it. Useful for security-conscious hosts that want CSP-style guarantees
   * without trusting runtime sniffing. When true, `evaluate()` always
   * delegates to `fallback`.
   *
   * Mirrors `InvectConfig.execution.disableNativeEval`.
   *
   * @default false
   */
  disableNativeEval?: boolean;

  /**
   * Sandboxed evaluator to use when `new Function` is unavailable (or when
   * `disableNativeEval` is set). Typically a `JsExpressionService` instance,
   * but any `JsExpressionEvaluator` works.
   *
   * Optional — when omitted and the native path is unavailable, `evaluate()`
   * throws a clear, actionable error instead of attempting a forbidden
   * `new Function` call.
   */
  fallback?: JsExpressionEvaluator;
}

/**
 * DirectEvaluator — unsandboxed `new Function` backend with edge-runtime
 * fallback.
 *
 * Use ONLY when:
 *   - the host trusts the flow author (single-tenant, edge self-deployment), or
 *   - the runtime already isolates at the request level (Vercel Workflow step,
 *     Cloudflare DO with per-flow isolation).
 *
 * Caveats:
 *   - No CPU / memory limits (infinite loops hang the host).
 *   - No syscall sandbox — user code has whatever globals the runtime exposes.
 *   - Cloudflare Workers block `new Function` without `compatibility_flags =
 *     ["unsafe_eval"]` (or nodejs_compat_v2). On those runtimes the constructor
 *     check at module load returns `HAS_EVAL = false` and `evaluate()` will
 *     delegate to a configured `fallback` (or throw a clear error if none).
 */
export class DirectEvaluator implements JsExpressionEvaluator {
  private readonly disableNativeEval: boolean;
  private readonly fallback?: JsExpressionEvaluator;

  constructor(options: DirectEvaluatorOptions = {}) {
    this.disableNativeEval = options.disableNativeEval ?? false;
    this.fallback = options.fallback;
  }

  async initialize(): Promise<void> {
    if (this.fallback?.initialize) {
      await this.fallback.initialize();
    }
  }

  async evaluate(expression: string, context: Record<string, unknown>): Promise<unknown> {
    if (this.disableNativeEval || !HAS_EVAL) {
      if (!this.fallback) {
        throw new JsExpressionEvaluationError(
          this.disableNativeEval
            ? 'DirectEvaluator: native eval disabled via disableNativeEval, but no fallback evaluator was configured'
            : 'DirectEvaluator: `new Function` is not available in this runtime (e.g. Cloudflare Workers without `unsafe_eval`, strict CSP), and no fallback evaluator was configured',
          expression,
        );
      }
      return this.fallback.evaluate(expression, context);
    }

    const safeKeys = Object.keys(context).filter((k) => VALID_JS_IDENT.test(k));
    const userBody = needsAutoReturn(expression) ? `return (${expression})` : expression;
    const destructure = safeKeys.length > 0 ? `const {${safeKeys.join(',')}} = $input;` : '';
    const body = `${destructure}${userBody}`;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function('$input', body) as (input: Record<string, unknown>) => unknown;
      const result = fn(context);
      if (result instanceof Promise) {
        throw new Error('Async expressions are not supported in DirectEvaluator');
      }
      return result;
    } catch (error) {
      if (error instanceof JsExpressionEvaluationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new JsExpressionEvaluationError(message, expression);
    }
  }
}
