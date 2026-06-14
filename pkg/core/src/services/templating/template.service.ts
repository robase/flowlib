/**
 * Template Service
 *
 * Evaluates {{ expression }} blocks as JavaScript using the JsExpressionService
 * (QuickJS WASM sandbox). Drop-in replacement for NunjucksService.
 *
 * Behavior:
 * - "Pure expression" templates (entire value is a single {{ expr }})
 *   return the raw JS value (object, array, number, etc.).
 * - "Mixed" templates (text with embedded {{ expr }} blocks)
 *   always return a string, with each expression result stringified.
 * - Errors inside {{ }} in mixed templates produce empty string (matches
 *   Nunjucks' throwOnUndefined:false behavior).
 *
 * Context keys are injected as local variables in the QuickJS sandbox.
 * `$input` is always available as the full context object.
 */
import type { JsExpressionService } from './js-expression.service';
import type { Logger } from 'src/schemas';

export interface TemplateRenderResult {
  success: boolean;
  value: unknown;
  error?: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Detect at least one `{{ … }}` block, without a regex. Equivalent to
 * `/\{\{[^}]*\}\}/.test(value)` (a `{{`, then non-`}` chars, then `}}`) but
 * linear — the regex form is polynomial (ReDoS) because `.test` retries at
 * every position and `value` can be attacker-controlled (a flow input).
 */
function containsTemplateBlock(value: string): boolean {
  let from = value.indexOf('{{');
  while (from !== -1) {
    let j = from + 2;
    while (j < value.length && value[j] !== '}') {
      j += 1;
    }
    if (value.startsWith('}}', j)) {
      return true;
    }
    from = value.indexOf('{{', from + 1);
  }
  return false;
}

/** Regex to detect a "pure expression": the entire string is one {{ expr }} with no other text or expressions. */
const PURE_EXPRESSION_PATTERN = /^\{\{([\s\S]*?)\}\}$/;

/**
 * Checks whether a string is a "pure" single-expression template
 * (i.e. the entire string is exactly `{{ expression }}`).
 *
 * The PURE_EXPRESSION_PATTERN is non-greedy but still stretches to the final
 * `}}$`, so a mixed template like `{{ a }} {{ b }}` also matches. We reject
 * any match whose captured expression still contains `{{` or `}}` — that
 * means there was another block or stray delimiter, so it's not pure.
 */
function isPureExpression(template: string): RegExpMatchArray | null {
  const m = template.match(PURE_EXPRESSION_PATTERN);
  if (!m) {
    return null;
  }
  const inner = m[1];
  if (inner.includes('{{') || inner.includes('}}')) {
    return null;
  }
  m[1] = inner.trim();
  return m;
}

/** Regex to match each {{ … }} block for replacement. */
const EXPRESSION_BLOCK_PATTERN = /\{\{([\s\S]*?)\}\}/g;

/** Regex for a valid JavaScript identifier (used for context destructuring). */
const _VALID_JS_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Helper functions injected into every sandbox evaluation context.
 * These provide backward compatibility with the Nunjucks custom filters/globals.
 *
 * Stored as individual entries so we can skip ones that collide with context keys.
 */
const COMPAT_HELPER_ENTRIES: Array<{ name: string; code: string }> = [
  {
    name: 'json',
    code: 'function json(obj, indent) { return JSON.stringify(obj, null, indent ?? 2); }',
  },
  {
    name: 'first',
    code: 'function first(arr) { return Array.isArray(arr) && arr.length > 0 ? arr[0] : null; }',
  },
  {
    name: 'last',
    code: 'function last(arr) { return Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null; }',
  },
  {
    name: 'keys',
    code: "function keys(obj) { return obj && typeof obj === 'object' ? Object.keys(obj) : []; }",
  },
  {
    name: 'values',
    code: "function values(obj) { return obj && typeof obj === 'object' ? Object.values(obj) : []; }",
  },
  { name: 'exists', code: 'function exists(val) { return val !== null && val !== undefined; }' },
  { name: 'isArray', code: 'function isArray(val) { return Array.isArray(val); }' },
  {
    name: 'isObject',
    code: "function isObject(val) { return val !== null && typeof val === 'object' && !Array.isArray(val); }",
  },
];

export class TemplateService {
  private jsExpressionService: JsExpressionService;
  private logger?: Logger;

  constructor(jsExpressionService: JsExpressionService, logger?: Logger) {
    this.jsExpressionService = jsExpressionService;
    this.logger = logger;
  }

  /**
   * Check if a string contains template expressions {{ … }}.
   */
  isTemplate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    return containsTemplateBlock(value);
  }

  /**
   * Render a template string by evaluating {{ expr }} blocks as JavaScript.
   *
   * - Pure expression (entire value is `{{ expr }}`): returns raw JS value.
   * - Mixed template: returns interpolated string.
   */
  async render(template: string, context: Record<string, unknown>): Promise<unknown> {
    // Pure expression — return raw value (object, array, number, etc.)
    const pureMatch = isPureExpression(template);
    if (pureMatch) {
      return this.evaluateExpression(pureMatch[1].trim(), context);
    }

    // Mixed template — string interpolation, errors → empty string
    // Cannot use String.replace with async callback, so iterate matches manually.
    let result = '';
    let lastIndex = 0;
    // oxlint-disable-next-line security/detect-non-literal-regexp -- creating global variant of existing pattern
    const pattern = new RegExp(EXPRESSION_BLOCK_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(template)) !== null) {
      result += template.slice(lastIndex, match.index);
      const expr = match[1].trim();
      try {
        const exprResult = await this.evaluateExpression(expr, context);
        if (exprResult === null || exprResult === undefined) {
          // empty string
        } else if (typeof exprResult === 'object') {
          result += JSON.stringify(exprResult);
        } else {
          result += String(exprResult);
        }
      } catch (error) {
        this.logger?.debug('Template expression error (swallowed)', {
          expression: expr,
          error: error instanceof Error ? error.message : String(error),
        });
        // empty string on error
      }
      lastIndex = match.index + match[0].length;
    }
    result += template.slice(lastIndex);
    return result;
  }

  /**
   * Render a template with error handling, returning a result object.
   */
  async safeRender(
    template: string,
    context: Record<string, unknown>,
  ): Promise<TemplateRenderResult> {
    try {
      const value = await this.render(template, context);
      return { success: true, value };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, value: '', error: errorMessage };
    }
  }

  /**
   * Validate a template string by checking expression syntax without executing.
   */
  async validate(template: string): Promise<TemplateValidationResult> {
    const expressions: string[] = [];
    let match;
    // oxlint-disable-next-line security/detect-non-literal-regexp -- creating global variant of existing pattern
    const pattern = new RegExp(EXPRESSION_BLOCK_PATTERN.source, 'g');
    while ((match = pattern.exec(template)) !== null) {
      expressions.push(match[1].trim());
    }

    if (expressions.length === 0) {
      return { valid: true };
    }

    // Try to evaluate with an empty context — syntax errors will surface
    for (const expr of expressions) {
      try {
        // Use a dummy context to check syntax; runtime errors are fine
        await this.evaluateExpression(expr, {});
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Only treat syntax errors as invalid; runtime errors (undefined vars) are OK
        if (msg.includes('SyntaxError') || msg.includes('Unexpected token')) {
          return { valid: false, error: `Invalid expression: ${expr} — ${msg}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Extract root-level variable references from a template.
   * Returns the first identifier in each {{ expr }} block.
   */
  extractVariableReferences(template: string): string[] {
    const refs: string[] = [];
    const pattern = /\{\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let match;
    while ((match = pattern.exec(template)) !== null) {
      if (!refs.includes(match[1])) {
        refs.push(match[1]);
      }
    }
    return refs;
  }

  /**
   * Get root-level keys referenced in a template.
   */
  getRootReferences(template: string): string[] {
    return this.extractVariableReferences(template);
  }

  /**
   * Evaluate a single JS expression against a context.
   *
   * Wraps the expression with compat helpers and context destructuring,
   * then delegates to JsExpressionService.evaluate().
   */
  private async evaluateExpression(
    expression: string,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    // Build compat helpers, skipping any whose name collides with a context key
    // (sandbox disallows re-declaring a `const`-destructured variable as a function).
    const contextKeys = new Set(Object.keys(context));
    const helpers = COMPAT_HELPER_ENTRIES.filter((h) => !contextKeys.has(h.name))
      .map((h) => h.code)
      .join('\n');

    const wrapped = helpers ? `${helpers}\nreturn (${expression});` : `return (${expression});`;
    return this.jsExpressionService.evaluate(wrapped, context);
  }
}

// ── Factory helpers ──────────────────────────────────────────────────────────
//
// The previous `getTemplateService()` memoized a module-level instance, which
// meant the first `createFlowlib()` call's `JsExpressionService` won —
// subsequent instances silently reused the same `TemplateService` and ignored
// their own QuickJS runtime. Per-instance state belongs on the
// `FlowlibInstance`, so `createTemplateService` is now the canonical factory
// and `getTemplateService` is a deprecated pass-through that always returns a
// fresh instance.

export function createTemplateService(
  jsExpressionService: JsExpressionService,
  logger?: Logger,
): TemplateService {
  return new TemplateService(jsExpressionService, logger);
}

/**
 * @deprecated Use `createTemplateService(jsExpressionService, logger)` and
 * hold the resulting instance on your `ServiceFactory` / `FlowlibInstance`.
 * Returning a module-level singleton breaks correctness when multiple
 * `createFlowlib()` instances share a process — they would unknowingly
 * share the first instance's `JsExpressionService`.
 */
export function getTemplateService(
  jsExpressionService: JsExpressionService,
  logger?: Logger,
): TemplateService {
  return createTemplateService(jsExpressionService, logger);
}

/** No-op retained for backward compatibility. Previously reset the module-level singleton. */
// eslint-disable-next-line typescript/no-empty-function
export function resetTemplateService(): void {}
