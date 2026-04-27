/**
 * Arrow function → QuickJS string extraction.
 *
 * Given a JavaScript function value produced by evaluating SDK source, extract
 * its body as a string suitable for QuickJS evaluation. Also validate that the
 * body only uses language features the QuickJS runtime supports — no async,
 * await, generators, dynamic imports, try/catch, loops, class declarations, or
 * closures over identifiers not in `ctx` / the allowed-globals set.
 *
 * Uses the TypeScript compiler API for parsing + walking. TypeScript is only
 * pulled in for the transform subpath (`@flowlib/sdk/transform`); normal
 * consumers never import it.
 *
 * Strategy:
 *   1. `Function.prototype.toString()` gives us the original source text of the
 *      authored arrow (jiti preserves it; no bundler minification here).
 *   2. Parse that string with `ts.createSourceFile`.
 *   3. Walk the AST to find the arrow function expression.
 *   4. Collect declared names (from the parameter — typically `ctx` or a
 *      destructuring pattern).
 *   5. Walk the body — reject disallowed syntax, flag free identifiers.
 *   6. Extract the body text (either the expression for concise arrows or the
 *      block body for `(ctx) => { ... }` forms).
 */

import ts from 'typescript';
import type { TransformDiagnostic, TransformDiagnosticCode } from './types';

/** Identifiers safe to reference from arrow bodies (standard library). */
const DEFAULT_ALLOWED_GLOBALS: ReadonlySet<string> = new Set([
  'Math',
  'JSON',
  'Array',
  'Object',
  'Number',
  'String',
  'Boolean',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'Symbol',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'undefined',
  'null',
  'NaN',
  'Infinity',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
  'JSON',
]);

export interface ExtractionResult {
  /** The extracted expression string (e.g. `"ctx.x > 5"` or a statement block). */
  body: string;
  /** The context parameter name(s) — `["ctx"]` for the common case, `["x", "y"]` for destructuring. */
  ctxParamNames: string[];
  /** Whether the arrow was a concise (expression) body or a block body. */
  isBlockBody: boolean;
  /** Diagnostics produced during extraction — always non-error if body is set. */
  diagnostics: TransformDiagnostic[];
}

export interface ExtractOptions {
  /** Additional identifiers to treat as safe globals. */
  allowedGlobals?: Iterable<string>;
  /** Node referenceId + path for diagnostics. */
  nodeRef: string;
  path: string;
}

/**
 * Extract a QuickJS expression string from an arrow function value.
 *
 * Always returns an `ExtractionResult` — `body` is populated when extraction
 * succeeded, otherwise `diagnostics` will contain one or more `error`-level
 * entries describing what went wrong.
 */
export function extractArrowBody(fn: unknown, options: ExtractOptions): ExtractionResult {
  const diagnostics: TransformDiagnostic[] = [];
  const addDiag = (
    level: TransformDiagnostic['level'],
    code: TransformDiagnosticCode,
    message: string,
  ) => {
    diagnostics.push({ level, code, message, nodeRef: options.nodeRef, path: options.path });
  };

  const emptyResult = (): ExtractionResult => ({
    body: '',
    ctxParamNames: [],
    isBlockBody: false,
    diagnostics,
  });

  if (typeof fn !== 'function') {
    addDiag('error', 'not-a-function', `expected a function, got ${typeof fn}`);
    return emptyResult();
  }

  const source = fn.toString();
  const sourceFile = ts.createSourceFile(
    '__arrow__.ts',
    `const __arrow__ = (${source});`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );

  // Find the wrapped expression: `const __arrow__ = (<expr>);`
  const stmt = sourceFile.statements[0];
  if (!ts.isVariableStatement(stmt)) {
    addDiag('error', 'parse-failed', 'could not parse function source');
    return emptyResult();
  }
  const decl = stmt.declarationList.declarations[0];
  const init = decl?.initializer;
  if (!init) {
    addDiag('error', 'parse-failed', 'function source had no initializer');
    return emptyResult();
  }
  // Unwrap the outer parens.
  const expr = ts.isParenthesizedExpression(init) ? init.expression : init;

  if (ts.isFunctionExpression(expr)) {
    // Handles both named and anonymous `function` expressions (what jiti
    // + some runtimes produce for arrows written with `function` syntax).
    if (expr.asteriskToken) {
      addDiag('error', 'generator', 'generator functions are not allowed');
      return emptyResult();
    }
    if (expr.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      addDiag('error', 'async-arrow', 'async functions are not allowed');
      return emptyResult();
    }
    return extractFromFunctionLike(expr, options, addDiag, diagnostics);
  }

  if (!ts.isArrowFunction(expr)) {
    addDiag(
      'error',
      'not-an-arrow',
      `expected an arrow function or function expression, got ${ts.SyntaxKind[expr.kind]}`,
    );
    return emptyResult();
  }

  if (expr.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
    addDiag('error', 'async-arrow', 'async arrow functions are not allowed');
    return emptyResult();
  }

  return extractFromFunctionLike(expr, options, addDiag, diagnostics);
}

function extractFromFunctionLike(
  expr: ts.ArrowFunction | ts.FunctionExpression,
  options: ExtractOptions,
  addDiag: (
    level: TransformDiagnostic['level'],
    code: TransformDiagnosticCode,
    message: string,
  ) => void,
  diagnostics: TransformDiagnostic[],
): ExtractionResult {
  const allowed = new Set([...DEFAULT_ALLOWED_GLOBALS, ...(options.allowedGlobals ?? [])]);

  // Extract parameter binding names (the common cases: `ctx`, `({ x, y })`).
  const ctxParamNames: string[] = [];
  if (expr.parameters.length > 1) {
    addDiag(
      'error',
      'bad-ctx-param',
      `arrow/function must take zero or one parameter, got ${expr.parameters.length}`,
    );
    return { body: '', ctxParamNames, isBlockBody: false, diagnostics };
  }
  if (expr.parameters.length === 1) {
    const p = expr.parameters[0];
    if (p.dotDotDotToken) {
      addDiag('error', 'bad-ctx-param', 'rest parameters are not allowed');
      return { body: '', ctxParamNames, isBlockBody: false, diagnostics };
    }
    collectBindingNames(p.name, ctxParamNames);
  }

  // The allowed scope inside the body = param-bound names + std globals.
  const localScope = new Set<string>(ctxParamNames);
  const globalsScope = allowed;

  // Walk the body; collect diagnostics for disallowed syntax.
  walkBody(expr.body, localScope, globalsScope, addDiag);
  if (diagnostics.some((d) => d.level === 'error')) {
    return { body: '', ctxParamNames, isBlockBody: false, diagnostics };
  }

  // Emit the body text.
  const isBlockBody = ts.isBlock(expr.body);
  let body: string;
  if (isBlockBody) {
    body = expr.body.statements.map((s) => s.getText()).join('\n');
  } else {
    body = expr.body.getText();
  }

  return { body, ctxParamNames, isBlockBody, diagnostics };
}

// ═══════════════════════════════════════════════════════════════════════════
// Binding-pattern traversal
// ═══════════════════════════════════════════════════════════════════════════

function collectBindingNames(node: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isObjectBindingPattern(node)) {
    for (const el of node.elements) {
      if (el.dotDotDotToken) {
        // Rest binding — include the name.
        if (ts.isIdentifier(el.name)) {
          out.push(el.name.text);
        }
        continue;
      }
      collectBindingNames(el.name, out);
    }
    return;
  }
  if (ts.isArrayBindingPattern(node)) {
    for (const el of node.elements) {
      if (ts.isBindingElement(el)) {
        collectBindingNames(el.name, out);
      }
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Body walker — enforce the allowed subset
// ═══════════════════════════════════════════════════════════════════════════

function walkBody(
  body: ts.ConciseBody,
  localScope: Set<string>,
  globalsScope: ReadonlySet<string>,
  addDiag: (
    level: TransformDiagnostic['level'],
    code: TransformDiagnosticCode,
    message: string,
  ) => void,
): void {
  // Per-scope walker — walks a body with its own scope chain. Nested
  // functions/arrows get their own child scope so inner parameters don't
  // leak out and inner references fall back through to the parent scope.
  const walkScope = (node: ts.ConciseBody, parentScope: ReadonlySet<string>): void => {
    const scope = new Set(parentScope);

    const visit = (n: ts.Node): void => {
      // Reject disallowed constructs.
      switch (n.kind) {
        case ts.SyntaxKind.AwaitExpression:
          addDiag('error', 'await-expression', '`await` is not allowed in QuickJS expressions');
          return;
        case ts.SyntaxKind.YieldExpression:
          addDiag('error', 'generator', 'generators / `yield` are not allowed');
          return;
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
          addDiag(
            'error',
            'loop',
            'loop statements are not allowed — use array methods (map/filter/reduce) instead',
          );
          return;
        case ts.SyntaxKind.TryStatement:
          addDiag('error', 'try-catch', '`try/catch` is not allowed');
          return;
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
          addDiag('error', 'class-declaration', 'class declarations/expressions are not allowed');
          return;
      }

      // Dynamic import → ImportKeyword in a CallExpression.
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addDiag('error', 'dynamic-import', 'dynamic `import()` is not allowed');
        return;
      }

      // Nested arrow / function expression — validate modifiers here (async
      // is rejected) and recurse into its body with a child scope. We do NOT
      // let forEachChild visit its body afterwards.
      if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
        if (n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          addDiag('error', 'async-arrow', 'nested async functions are not allowed');
          return;
        }
        if (ts.isFunctionExpression(n) && n.asteriskToken) {
          addDiag('error', 'generator', 'nested generator functions are not allowed');
          return;
        }
        // Build the child scope from this function's parameter bindings.
        const childScope = new Set(scope);
        for (const p of n.parameters) {
          if (p.dotDotDotToken) {
            addDiag('error', 'bad-ctx-param', 'rest parameters are not allowed');
            continue;
          }
          const names: string[] = [];
          collectBindingNames(p.name, names);
          for (const name of names) {
            childScope.add(name);
          }
        }
        walkScope(n.body, childScope);
        return;
      }

      // Track local bindings introduced by `const`/`let`/`var` declarations so
      // identifiers declared later in the body don't get flagged as unknown.
      if (ts.isVariableStatement(n)) {
        for (const decl of n.declarationList.declarations) {
          const names: string[] = [];
          collectBindingNames(decl.name, names);
          for (const name of names) {
            scope.add(name);
          }
        }
      }

      // Nested named function declarations — add the name to scope (don't
      // recurse; the function-expression handler above covers callable forms).
      if (ts.isFunctionDeclaration(n) && n.name) {
        scope.add(n.name.text);
      }

      // Identifier references — flag free variables not in scope or globals.
      if (
        ts.isIdentifier(n) &&
        !isIdentifierADeclaration(n) &&
        !isIdentifierAPropertyName(n) &&
        !isIdentifierAPropertyAccess(n) &&
        !isIdentifierATypeRef(n)
      ) {
        const name = n.text;
        if (!scope.has(name) && !globalsScope.has(name)) {
          addDiag(
            'error',
            'unknown-identifier',
            `reference to unknown identifier "${name}" — arrow bodies can only use ctx-bound names and standard-library globals`,
          );
        }
      }

      ts.forEachChild(n, visit);
    };

    if (ts.isBlock(node)) {
      for (const s of node.statements) {
        visit(s);
      }
    } else {
      visit(node);
    }
  };

  walkScope(body, localScope);
}

// ═══════════════════════════════════════════════════════════════════════════
// Identifier-position classification
// ═══════════════════════════════════════════════════════════════════════════

function isIdentifierADeclaration(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) {
    return false;
  }
  if (ts.isVariableDeclaration(p) && p.name === id) {
    return true;
  }
  if (ts.isParameter(p) && p.name === id) {
    return true;
  }
  if (ts.isBindingElement(p) && p.name === id) {
    return true;
  }
  if (ts.isFunctionDeclaration(p) && p.name === id) {
    return true;
  }
  if (ts.isFunctionExpression(p) && p.name === id) {
    return true;
  }
  return false;
}

function isIdentifierAPropertyName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) {
    return false;
  }
  if (ts.isPropertyAssignment(p) && p.name === id) {
    return true;
  }
  if (ts.isShorthandPropertyAssignment(p) && p.name === id) {
    return false;
  } // shorthand DOES reference outer scope
  if (ts.isMethodDeclaration(p) && p.name === id) {
    return true;
  }
  if (ts.isPropertySignature(p) && p.name === id) {
    return true;
  }
  if (ts.isBindingElement(p) && p.propertyName === id) {
    return true;
  }
  return false;
}

function isIdentifierAPropertyAccess(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) {
    return false;
  }
  // Only the `.foo` part of `x.foo` is a property access (not the root `x`).
  if (ts.isPropertyAccessExpression(p) && p.name === id) {
    return true;
  }
  return false;
}

function isIdentifierATypeRef(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) {
    return false;
  }
  // Type annotations in TS source — not runtime identifiers.
  return (
    ts.isTypeReferenceNode(p) ||
    ts.isQualifiedName(p) ||
    ts.isTypeQueryNode(p) ||
    (ts.isPropertyAccessExpression(p) && ts.isTypeQueryNode(p.parent))
  );
}
