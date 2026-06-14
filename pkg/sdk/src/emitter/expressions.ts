/**
 * Expression rendering.
 *
 * DB stores JS expressions as strings evaluated in QuickJS with direct-parent
 * referenceIds as locals + `previous_nodes` for indirect ancestors + `$input`
 * for full incoming data. This module renders them back as arrow functions
 * `(ctx) => ...` with the matching bindings destructured from `ctx`.
 *
 * Mirrors the behavior of the in-runtime `JsExpressionService` + the primitives
 * emitter's arrow-rendering — single source of truth for what the load-path
 * source looks like.
 */

import { isValidJsIdent } from './literals';

/**
 * Determine whether an expression needs an auto-`return`.
 *
 * Matches `needsAutoReturn` in `@flowlib/core`'s templating evaluator: strips
 * comments + string contents, then tests for a `return` keyword.
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
 * Build an arrow-function source from a DB-stored expression string.
 *
 * Destructures `upstream` referenceIds from `ctx` so the expression has the
 * same local names it did under QuickJS. `previous_nodes` is destructured when
 * the expression references it (indirect ancestors). `$input` stays on `ctx`
 * — the runtime exposes it as `ctx.$input` for SDK-origin flows.
 */
export function arrowFromExpression(expression: string, upstream: string[]): string {
  const body = needsAutoReturn(expression) ? `return (${expression});` : expression;
  return arrowFromBody(body, upstream, /\bprevious_nodes\b/.test(expression));
}

function arrowFromBody(body: string, upstream: string[], includePreviousNodes: boolean): string {
  const names = upstream.filter(isValidJsIdent);
  if (includePreviousNodes && !names.includes('previous_nodes')) {
    names.push('previous_nodes');
  }
  const destructure = names.length > 0 ? `const { ${names.join(', ')} } = ctx;` : '';

  // Single-line bodies with no destructuring → inline form for readability.
  if (!destructure && !body.includes('\n')) {
    return `(ctx) => { ${body} }`;
  }

  const lines: string[] = ['(ctx) => {'];
  if (destructure) {
    lines.push(`  ${destructure}`);
  }
  for (const l of body.split('\n')) {
    lines.push(`  ${l}`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Render an "output value" — a string that may be a pure `{{ expr }}` block,
 * mixed text + `{{ expr }}` blocks, or a plain literal. Produces an arrow
 * function appropriate for the primitives-runtime `output()` helper.
 *
 *   - pure `{{ expr }}`           → `(ctx) => (expr)`
 *   - mixed `Hi {{ user.name }}`  → template literal inside an arrow
 *   - plain string                → `(ctx) => "string"`
 *   - non-string literal          → `(ctx) => (JSON.stringify(value))`
 */
export function arrowFromOutputValue(raw: unknown, upstream: string[]): string {
  if (typeof raw !== 'string') {
    return `(ctx) => (${JSON.stringify(raw)})`;
  }

  const TEMPLATE_BLOCK = /\{\{((?:[^}]|\}(?!\}))*)\}\}/g;
  if (!TEMPLATE_BLOCK.test(raw)) {
    return `(ctx) => (${JSON.stringify(raw)})`;
  }

  // Pure expression: entire string is a single `{{ expr }}` block.
  const pure = raw.match(/^\{\{((?:[^}]|\}(?!\}))*)\}\}$/);
  if (pure && !pure[1].includes('{{') && !pure[1].includes('}}')) {
    return arrowFromExpression(pure[1].trim(), upstream);
  }

  // Mixed → template literal.
  const parts: string[] = [];
  let lastIndex = 0;
  const exprBody = /\{\{((?:[^}]|\}(?!\}))*)\}\}/g;
  let m: RegExpExecArray | null;
  let touchesPreviousNodes = false;
  while ((m = exprBody.exec(raw)) !== null) {
    parts.push(escapeTemplateLiteralText(raw.slice(lastIndex, m.index)));
    const inner = m[1].trim();
    if (/\bprevious_nodes\b/.test(inner)) {
      touchesPreviousNodes = true;
    }
    parts.push('${(' + inner + ')}');
    lastIndex = m.index + m[0].length;
  }
  parts.push(escapeTemplateLiteralText(raw.slice(lastIndex)));

  const templateLiteral = '`' + parts.join('') + '`';
  return arrowFromBody(`return (${templateLiteral});`, upstream, touchesPreviousNodes);
}

function escapeTemplateLiteralText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
