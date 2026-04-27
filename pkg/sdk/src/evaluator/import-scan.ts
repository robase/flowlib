/**
 * Pre-eval import scanner.
 *
 * Walks the source AST to enumerate import specifiers BEFORE evaluating.
 * Rejects anything outside the allowlist so that a malicious / careless source
 * can't smuggle in `node:fs`, `process`, `child_process`, dynamic `import()`,
 * or filesystem paths. This is a defense-in-depth measure on top of the module
 * resolver the evaluator installs.
 *
 * Allowlist structure:
 *   - Exact matches: `@flowlib/sdk`, `@flowlib/sdk/transform`, `@flowlib/sdk/evaluator`.
 *   - Prefix matches: `@flowlib/actions/*` (every subpath), `@flowlib/action-kit/*`.
 *   - Caller-supplied via `additionalAllowedImports` option — useful for custom
 *     user action packages registered with the evaluator.
 *
 * Dynamic `import()` is always rejected — runtime-resolved imports bypass the
 * static check and would let `import('node:fs')` through.
 */

import ts from 'typescript';
import type { EvaluatorError } from './types';

const DEFAULT_ALLOWED_EXACT: ReadonlySet<string> = new Set([
  '@flowlib/sdk',
  '@flowlib/sdk/transform',
  '@flowlib/sdk/evaluator',
  '@flowlib/action-kit',
]);

const DEFAULT_ALLOWED_PREFIXES: readonly string[] = [
  '@flowlib/actions/',
  '@flowlib/action-kit/',
  '@flowlib/sdk/',
];

export interface ScanResult {
  /** Unique import specifiers that passed the allowlist. */
  allowedImports: string[];
  /** Errors for disallowed / unparseable imports. */
  errors: EvaluatorError[];
}

export function scanImports(source: string, additionalAllowed: readonly string[] = []): ScanResult {
  const errors: EvaluatorError[] = [];
  const allowedImports = new Set<string>();
  const extraExact = new Set(additionalAllowed);

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      '__flow__.ts',
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
  } catch (err) {
    errors.push({
      code: 'import-parse-failed',
      message: `failed to parse source for import scan: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { allowedImports: [], errors };
  }

  const checkSpecifier = (specifier: string, node: ts.Node): void => {
    if (isAllowedSpecifier(specifier, extraExact)) {
      allowedImports.add(specifier);
      return;
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    errors.push({
      code: 'import-forbidden',
      message: `import specifier "${specifier}" is not allowed — only @flowlib/sdk, @flowlib/action-kit, @flowlib/actions/* and caller-registered modules are permitted`,
      specifier,
      line: line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    // Static `import … from '…'`
    if (ts.isImportDeclaration(node)) {
      const mod = node.moduleSpecifier;
      if (ts.isStringLiteral(mod)) {
        checkSpecifier(mod.text, mod);
      } else {
        const { line } = sourceFile.getLineAndCharacterOfPosition(mod.getStart(sourceFile));
        errors.push({
          code: 'import-parse-failed',
          message: 'import specifier must be a string literal',
          line: line + 1,
        });
      }
      return;
    }

    // `import '…'` (side-effect only)
    if (ts.isImportEqualsDeclaration(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      errors.push({
        code: 'import-forbidden',
        message: '`import … =` declarations are not allowed',
        line: line + 1,
      });
      return;
    }

    // `export … from '…'`
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
      }
      return;
    }

    // Dynamic `import('…')`
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      errors.push({
        code: 'dynamic-import',
        message: 'dynamic `import()` is not allowed in flow source',
        line: line + 1,
      });
      return;
    }

    // `require('…')`
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      errors.push({
        code: 'import-forbidden',
        message: '`require(...)` is not allowed — use `import` statements only',
        line: line + 1,
      });
      return;
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return { allowedImports: [...allowedImports], errors };
}

function isAllowedSpecifier(specifier: string, extraExact: Set<string>): boolean {
  if (DEFAULT_ALLOWED_EXACT.has(specifier)) {
    return true;
  }
  if (extraExact.has(specifier)) {
    return true;
  }
  for (const prefix of DEFAULT_ALLOWED_PREFIXES) {
    if (specifier.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}
