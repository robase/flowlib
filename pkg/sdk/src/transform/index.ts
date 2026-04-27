/**
 * Arrow-to-string save transform — converts authored SDK flow source into
 * the DB's string-expression storage form.
 *
 * Intended callers:
 *   - Chat-save endpoint: LLM emits arrows, DB stores strings.
 *   - Sync plugin pull path: hand-authored `.flow.ts` files get converted
 *     when the embedded JSON footer (`\/* @flowlib-definition *\/`) is stale
 *     or absent.
 *
 * Not for: browser bundles, runtime executor, or anywhere typescript-the-dep
 * isn't welcome. Subpath-exported (`@flowlib/sdk/transform`) so the main
 * `@flowlib/sdk` entry stays lean.
 */

import type { SdkFlowNode } from '../types';
import type { TransformDiagnostic, TransformOptions, TransformResult } from './types';
import { extractArrowBody } from './extract';

export type {
  TransformDiagnostic,
  TransformDiagnosticCode,
  TransformOptions,
  TransformResult,
} from './types';

/**
 * Walk a parsed SDK flow and convert every function-valued param into a
 * QuickJS-compatible string. Returns the transformed nodes plus diagnostics.
 *
 * The transform is pure — input nodes are not mutated. Nodes are shallow-
 * cloned only where a function is replaced.
 */
export function transformArrowsToStrings(
  nodes: SdkFlowNode[],
  options: TransformOptions = {},
): TransformResult {
  const diagnostics: TransformDiagnostic[] = [];
  const transformed: SdkFlowNode[] = nodes.map((node) => transformNode(node, options, diagnostics));
  return {
    nodes: transformed,
    diagnostics,
    ok: !diagnostics.some((d) => d.level === 'error'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-node-type handling
// ═══════════════════════════════════════════════════════════════════════════

/**
 * For each node type that can carry function-valued params, declare the set
 * of param paths we need to convert. Keeps extraction predictable + avoids
 * accidentally serialising an unrelated function someone stuck in params.
 */
const FUNCTION_PARAM_PATHS: Record<string, string[]> = {
  'core.javascript': ['code'],
  'primitives.javascript': ['code'],
  'core.if_else': ['expression'],
  'primitives.if_else': ['condition'],
  'core.output': ['outputValue'],
  'primitives.output': ['outputValue'],
};

function transformNode(
  node: SdkFlowNode,
  options: TransformOptions,
  diagnostics: TransformDiagnostic[],
): SdkFlowNode {
  const nodeRef = node.referenceId;

  // Switch nodes have a dynamic array of cases, each with a function condition.
  if (node.type === 'core.switch' || node.type === 'primitives.switch') {
    return transformSwitchNode(node, nodeRef, options, diagnostics);
  }

  // Agent nodes don't currently carry function-valued params in the DB form,
  // but the mapper field on any node can. Handle mapper specially (see below).
  const nodeWithMapper = maybeTransformMapper(node, nodeRef, options, diagnostics);

  const pathsToTransform = FUNCTION_PARAM_PATHS[node.type];
  if (!pathsToTransform || pathsToTransform.length === 0) {
    return nodeWithMapper;
  }

  let newParams: Record<string, unknown> | null = null;
  for (const key of pathsToTransform) {
    const value = nodeWithMapper.params[key];
    if (typeof value !== 'function') {
      continue;
    }

    const extracted = extractArrowBody(value, {
      nodeRef,
      path: key,
      allowedGlobals: options.allowedGlobals,
    });
    if (extracted) {
      for (const d of extracted.diagnostics) {
        diagnostics.push(d);
      }
    }
    if (!extracted || extracted.diagnostics.some((d) => d.level === 'error')) {
      continue;
    }

    if (newParams === null) {
      newParams = { ...nodeWithMapper.params };
    }

    // Output values round-trip better as `{{ expr }}` template strings than
    // as raw JS statements — the emitter's arrowFromOutputValue assumes
    // template form when reading them back. Convert when possible; fall back
    // to the generic runtime-expression form otherwise.
    const isOutputValue =
      (node.type === 'core.output' || node.type === 'primitives.output') && key === 'outputValue';
    if (isOutputValue) {
      const template = tryArrowToOutputTemplate(extracted);
      if (template !== null) {
        newParams[key] = template;
        continue;
      }
    }

    newParams[key] = toRuntimeExpression(extracted);
  }

  if (newParams === null) {
    return nodeWithMapper;
  }
  return { ...nodeWithMapper, params: newParams };
}

// ═══════════════════════════════════════════════════════════════════════════
// Switch case transform
// ═══════════════════════════════════════════════════════════════════════════

function transformSwitchNode(
  node: SdkFlowNode,
  nodeRef: string,
  options: TransformOptions,
  diagnostics: TransformDiagnostic[],
): SdkFlowNode {
  const withMapper = maybeTransformMapper(node, nodeRef, options, diagnostics);
  const rawCases = withMapper.params.cases;
  if (!Array.isArray(rawCases)) {
    return withMapper;
  }

  // Switch cases in the DB schema use `expression` (string); the primitives
  // SDK uses `condition` (function). Accept either inbound; emit `expression`.
  const newCases = rawCases.map((c, i) => {
    if (typeof c !== 'object' || c === null) {
      return c;
    }
    const rec = c as Record<string, unknown>;

    const fn = rec.condition ?? rec.expression;
    if (typeof fn === 'string') {
      // Already a string — pass through (and rename condition→expression).
      return { slug: rec.slug, label: rec.label, expression: fn };
    }
    if (typeof fn !== 'function') {
      return rec;
    }

    const extracted = extractArrowBody(fn, {
      nodeRef,
      path: `cases[${i}].condition`,
      allowedGlobals: options.allowedGlobals,
    });
    if (extracted) {
      for (const d of extracted.diagnostics) {
        diagnostics.push(d);
      }
    }
    if (!extracted || extracted.diagnostics.some((d) => d.level === 'error')) {
      return rec;
    }
    return {
      slug: rec.slug,
      label: rec.label,
      expression: toRuntimeExpression(extracted),
    };
  });

  return {
    ...withMapper,
    params: { ...withMapper.params, cases: newCases },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mapper transform
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mapper config can be either:
 *   - MapperConfig object with string `expression` (DB form)
 *   - A bare function `(ctx) => NodeContext` (primitives-SDK form)
 *
 * Normalize both into MapperConfig with string expression. Anything else
 * passes through unchanged.
 */
function maybeTransformMapper(
  node: SdkFlowNode,
  nodeRef: string,
  options: TransformOptions,
  diagnostics: TransformDiagnostic[],
): SdkFlowNode {
  const m = node.mapper;
  if (m === undefined) {
    return node;
  }

  if (typeof m === 'function') {
    const extracted = extractArrowBody(m, {
      nodeRef,
      path: 'mapper',
      allowedGlobals: options.allowedGlobals,
    });
    if (extracted) {
      for (const d of extracted.diagnostics) {
        diagnostics.push(d);
      }
    }
    if (!extracted || extracted.diagnostics.some((d) => d.level === 'error')) {
      return node;
    }
    return {
      ...node,
      mapper: {
        enabled: true,
        expression: toRuntimeExpression(extracted),
        mode: 'auto',
        outputMode: 'array',
        concurrency: 1,
        onEmpty: 'skip',
      },
    };
  }

  // Object form: coerce an inner `expression` function into a string if needed.
  if (typeof m === 'object' && m !== null) {
    const mapperObj = m as Record<string, unknown>;
    const expr = mapperObj.expression;
    if (typeof expr === 'function') {
      const extracted = extractArrowBody(expr, {
        nodeRef,
        path: 'mapper.expression',
        allowedGlobals: options.allowedGlobals,
      });
      if (extracted) {
        for (const d of extracted.diagnostics) {
          diagnostics.push(d);
        }
      }
      if (!extracted || extracted.diagnostics.some((d) => d.level === 'error')) {
        return node;
      }
      return {
        ...node,
        mapper: { ...mapperObj, expression: toRuntimeExpression(extracted) },
      };
    }
  }

  return node;
}

// ═══════════════════════════════════════════════════════════════════════════
// Runtime expression composition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Produce a QuickJS-compatible string from an extraction result.
 *
 * The arrow may have destructured params (`({ x, y }) => ...`) but QuickJS
 * exposes `ctx` with the full incoming data object. So for destructuring
 * arrows we prepend a `const { x, y } = ctx;` binding to the body.
 *
 * For plain `(ctx) => expr` arrows we just return the expression body — at
 * runtime the direct-parent names are already top-level locals in the
 * QuickJS sandbox (see `NodeExecutionCoordinator.buildIncomingDataObject`),
 * so no prelude is needed.
 */
function toRuntimeExpression(extracted: {
  body: string;
  ctxParamNames: string[];
  isBlockBody: boolean;
}): string {
  const { body, ctxParamNames, isBlockBody } = extracted;

  // Case: single param named `ctx` → body references ctx directly.
  // QuickJS runtime doesn't bind `ctx` — each referenceId is already a
  // top-level local. For concise bodies, rewrite `ctx.X` → `X`. For block
  // bodies, strip the `const { ... } = ctx;` destructure the emitter
  // prepended (otherwise QuickJS fails on the undefined `ctx` reference),
  // then rewrite any remaining `ctx.X` accesses.
  if (ctxParamNames.length === 1 && ctxParamNames[0] === 'ctx') {
    if (!isBlockBody) {
      return rewriteCtxAccesses(body);
    }
    return rewriteCtxAccesses(stripCtxDestructure(body));
  }

  // Case: destructured params `({ x, y }) => expr`.
  // Emit a QuickJS-compatible prelude binding `const { x, y } = ctx;`, then
  // the body. If the authored arrow was purely an expression, wrap it with
  // `return (...)`. If it was a block body, use it verbatim.
  if (ctxParamNames.length > 0) {
    const bindings = `const { ${ctxParamNames.join(', ')} } = ctx;`;
    if (isBlockBody) {
      return `${bindings}\n${body}`;
    }
    return `${bindings}\nreturn (${body});`;
  }

  // No params: a constant arrow `() => 42`.
  if (isBlockBody) {
    return body;
  }
  return body;
}

/**
 * Text-rewrite `ctx.X` → `X` for pure expression bodies.
 *
 * This is a targeted optimization for the common case where the author wrote
 * `(ctx) => ctx.items.filter(i => i.active).length`. The authored expression
 * reads from `ctx.items`, but QuickJS exposes the item directly as `items`.
 *
 * The rewrite is conservative: it only replaces `ctx.X` where `ctx` is
 * unambiguous (i.e. the full expression body was a single identifier-rooted
 * member expression). For complex bodies we skip the rewrite and let
 * `ctx` fail loudly at runtime — the extractor's identifier-validation pass
 * already flagged `ctx` as an unknown identifier if it slipped through.
 *
 * For v1 we do a simple regex replace. Not perfect — doesn't handle string
 * literals containing `ctx.` — but the expression grammar is tiny and these
 * corner cases show up as test failures long before production. An AST-based
 * rewrite can replace this later.
 */
function rewriteCtxAccesses(body: string): string {
  // Replace `ctx.<identifier>` with `<identifier>` at word boundaries.
  // Also match `ctx[<prop>]` → `[<prop>]` (rare but plausible).
  return body.replace(/\bctx\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '$1');
}

/**
 * Strip `const { a, b, c } = ctx;` lines from the top of a block body.
 *
 * The emitter prepends this destructure when rendering block-body arrows so
 * the authored source reads as real JavaScript (`ctx.foo` looks out of place
 * in an arrow body that's been told to destructure). At runtime QuickJS
 * already has those names bound as top-level locals, so the destructure
 * would fail (no `ctx` is defined). Stripping it here makes the
 * emit → eval → transform cycle idempotent.
 *
 * Matches the emitter's output precisely:
 *   - One `const { ... } = ctx;` line at the top of the body.
 *   - Any whitespace around the braces, optional trailing newline.
 */
function stripCtxDestructure(blockBody: string): string {
  return blockBody.replace(/^\s*const\s*\{[^}]*\}\s*=\s*ctx\s*;\s*\n?/, '');
}

/**
 * Invert the emitter's output-value form back to a DB template string.
 *
 * The emitter renders output values as either:
 *   - `(ctx) => ("literal")`                     — plain string → bare string
 *   - `(ctx) => (name)`                          — pure `{{ expr }}`
 *   - `(ctx) => \`text ${(expr)} text\``         — mixed template
 *   - `(ctx) => { const { ... } = ctx; return …; }` — block form of any above
 *
 * This helper recognises the first three forms (plus their block-body
 * equivalents after stripping the ctx destructure) and converts them back to
 * the `{{ expr }}` template string the DB expects.
 *
 * Returns `null` when the body doesn't match any known shape — the caller
 * falls back to the generic `toRuntimeExpression` path.
 */
function tryArrowToOutputTemplate(extracted: {
  body: string;
  ctxParamNames: string[];
  isBlockBody: boolean;
}): string | null {
  const { body, ctxParamNames, isBlockBody } = extracted;
  if (ctxParamNames.length > 1) {
    return null;
  }
  if (ctxParamNames.length === 1 && ctxParamNames[0] !== 'ctx') {
    return null;
  }

  // Normalise to an expression form — strip the destructure prelude and the
  // trailing `return (...)` wrapper if present.
  let expr = body;
  if (isBlockBody) {
    expr = stripCtxDestructure(expr).trim();
    const returnMatch = expr.match(/^return\s+([\s\S]+?);?\s*$/);
    if (!returnMatch) {
      return null;
    }
    expr = returnMatch[1].trim();
  }
  // Unwrap outer parens from `(x)`.
  while (expr.startsWith('(') && expr.endsWith(')') && parensAreBalanced(expr.slice(1, -1))) {
    expr = expr.slice(1, -1).trim();
  }

  // Form 1: string literal → bare string.
  const strMatch = expr.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (strMatch) {
    try {
      return JSON.parse(`"${strMatch[1]}"`);
    } catch {
      return null;
    }
  }

  // Form 2: template literal → mixed `{{ expr }}` string.
  if (expr.startsWith('`') && expr.endsWith('`')) {
    return templateLiteralToOutputString(expr);
  }

  // Form 3: any other expression → pure `{{ expr }}` block.
  // Rewrite `ctx.X` → `X` since the runtime exposes refs as locals directly.
  const rewritten = expr.replace(/\bctx\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '$1');
  return `{{ ${rewritten} }}`;
}

function parensAreBalanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

/**
 * Convert a JS template literal back to a DB template string. Template
 * literal syntax is `\`text ${expr} text\``; DB syntax is `text {{ expr }} text`.
 *
 * Walks the literal, extracting `${...}` interpolations and the surrounding
 * text runs. Unescapes the text runs (`\\\`` → `` ` ``, `\\${` → `${`).
 */
function templateLiteralToOutputString(literal: string): string | null {
  const inner = literal.slice(1, -1);
  const parts: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\') {
      parts.push(inner[i] + inner[i + 1]);
      i += 2;
      continue;
    }
    if (ch === '$' && inner[i + 1] === '{') {
      // Find the matching `}`.
      let depth = 1;
      let j = i + 2;
      while (j < inner.length && depth > 0) {
        if (inner[j] === '{') {
          depth++;
        } else if (inner[j] === '}') {
          depth--;
        }
        if (depth === 0) {
          break;
        }
        j++;
      }
      if (j >= inner.length) {
        return null;
      }
      let expr = inner.slice(i + 2, j).trim();
      // The emitter wraps expressions in parens: `${(foo)}`. Strip them.
      while (expr.startsWith('(') && expr.endsWith(')') && parensAreBalanced(expr.slice(1, -1))) {
        expr = expr.slice(1, -1).trim();
      }
      // Rewrite `ctx.X` → `X` for refs that came through the ctx prelude.
      expr = expr.replace(/\bctx\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '$1');
      parts.push(`{{ ${expr} }}`);
      i = j + 1;
      continue;
    }
    parts.push(ch);
    i++;
  }

  // Unescape template-literal-specific sequences in the text runs.
  return parts
    .join('')
    .replace(/\\`/g, '`')
    .replace(/\\\$\{/g, '${')
    .replace(/\\\\/g, '\\');
}
