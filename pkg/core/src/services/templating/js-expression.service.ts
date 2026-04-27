/**
 * JS Expression Service
 *
 * Provides sandboxed JavaScript evaluation for data mapper expressions.
 * Uses QuickJS WASM for safe, isolated execution without Node.js APIs.
 *
 * User code is wrapped in a function body — use `return` to produce a value.
 * For single-expression one-liners (no `return` keyword), `return` is auto-prepended.
 *
 * Context keys from upstream nodes are injected as local variables.
 * `$input` is always available as the full context object (escape hatch for name collisions).
 */
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import type { QuickJSWASMModule } from 'quickjs-emscripten';
import type { Logger } from 'src/schemas';
import { needsAutoReturn, type JsExpressionEvaluator } from './evaluator';
import { JsExpressionError } from '@flowlib/action-kit';

export { JsExpressionError };

export interface JsExpressionServiceConfig {
  /** Memory limit for the QuickJS runtime in MB. Default: 128 */
  memoryLimitMB?: number;
  /** CPU time limit per evaluation in milliseconds. Default: 5000 */
  cpuTimeLimitMs?: number;
}

const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_CPU_TIME_LIMIT_MS = 5000;
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024;

/** Matches a valid JavaScript identifier (used to filter context keys for safe destructuring). */
const VALID_JS_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export class JsExpressionService implements JsExpressionEvaluator {
  private quickJS: QuickJSWASMModule | null = null;
  private logger?: Logger;
  private config: Required<JsExpressionServiceConfig>;

  constructor(config: JsExpressionServiceConfig = {}, logger?: Logger) {
    this.logger = logger;
    this.config = {
      memoryLimitMB: config.memoryLimitMB ?? DEFAULT_MEMORY_LIMIT_MB,
      cpuTimeLimitMs: config.cpuTimeLimitMs ?? DEFAULT_CPU_TIME_LIMIT_MS,
    };
  }

  /**
   * Initialize the QuickJS WASM module.
   * Must be called before evaluate(). Safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.quickJS) {
      return;
    }

    this.quickJS = await getQuickJS();

    this.logger?.debug('JsExpressionService initialized', {
      engine: 'quickjs-wasm',
      memoryLimitMB: this.config.memoryLimitMB,
      cpuTimeLimitMs: this.config.cpuTimeLimitMs,
    });
  }

  /**
   * Evaluate JS code against a context object.
   *
   * User code is wrapped in a function body. Use `return` to produce a value.
   * For one-liners without `return`, the service auto-prepends it.
   *
   * Context keys are available as local variables. `$input` is the full context.
   */
  async evaluate(expression: string, context: Record<string, unknown>): Promise<unknown> {
    if (!this.quickJS) {
      throw new Error('JsExpressionService not initialized. Call initialize() first.');
    }

    try {
      const contextJson = JSON.stringify(context);
      const safeKeys = Object.keys(context).filter((key) => VALID_JS_IDENT.test(key));

      const userBody = needsAutoReturn(expression) ? `return (${expression})` : expression;
      const destructure = safeKeys.length > 0 ? `const {${safeKeys.join(',')}} = $input;` : '';
      const fnBody = `const $input = JSON.parse(${JSON.stringify(contextJson)});${destructure}${userBody}`;
      const wrapped = `(function(){${fnBody}})()`;

      const result = this.quickJS.evalCode(wrapped, {
        shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + this.config.cpuTimeLimitMs),
        memoryLimitBytes: this.config.memoryLimitMB * 1024 * 1024,
        maxStackSizeBytes: Math.min(
          this.config.memoryLimitMB * 1024 * 1024,
          DEFAULT_MAX_STACK_SIZE_BYTES,
        ),
      });

      if (isPromiseStateResult(result)) {
        throw new Error('Async expressions are not supported');
      }

      return result;
    } catch (error) {
      throw new JsExpressionError(normalizeExpressionError(error), expression);
    }
  }

  /**
   * Dispose the QuickJS module reference. Call on Flowlib shutdown.
   */
  dispose(): void {
    this.quickJS = null;
    this.logger?.debug('JsExpressionService disposed');
  }
}

function normalizeExpressionError(error: unknown): string {
  if (error && typeof error === 'object') {
    const name = 'name' in error && typeof error.name === 'string' ? error.name : undefined;
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : undefined;

    if (name === 'InternalError' && message === 'interrupted') {
      return 'CPU time limit exceeded';
    }

    if (message) {
      return message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isPromiseStateResult(result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('type' in result)) {
    return false;
  }

  const type = result.type;
  return type === 'pending' || type === 'fulfilled' || type === 'rejected';
}

// PR 14 (`flowlib-hosted/UPSTREAM.md`): the previous `getJsExpressionService`
// memoized a single `JsExpressionService` at module scope. The QuickJS WASM
// **module** is genuinely stateless and is cached internally by
// `getQuickJS()` — that cache is fine to share. The **service** instance,
// however, owns config (memory limit, CPU time limit) and a logger, so
// sharing it across `createFlowlib()` instances would silently apply the
// first instance's config to all subsequent ones. `createFlowlib()` and the
// legacy `Flowlib` class both already construct their own service via
// `new JsExpressionService(...)`; `getJsExpressionService` is retained
// as a deprecated convenience for external callers.

let defaultInstance: JsExpressionService | null = null;

export function createJsExpressionService(
  config?: JsExpressionServiceConfig,
  logger?: Logger,
): JsExpressionService {
  return new JsExpressionService(config, logger);
}

/**
 * @deprecated Construct a `new JsExpressionService(config, logger)` and
 * call `await service.initialize()` instead, keeping the instance on your
 * `ServiceFactory` / `FlowlibInstance`. The module-level singleton this
 * function used to return shared QuickJS state across `createFlowlib()`
 * instances — incorrect under multi-isolate runtimes.
 */
export async function getJsExpressionService(logger?: Logger): Promise<JsExpressionService> {
  if (!defaultInstance) {
    defaultInstance = new JsExpressionService({}, logger);
    await defaultInstance.initialize();
  }
  return defaultInstance;
}

export function disposeJsExpressionService(): void {
  if (defaultInstance) {
    defaultInstance.dispose();
    defaultInstance = null;
  }
}
