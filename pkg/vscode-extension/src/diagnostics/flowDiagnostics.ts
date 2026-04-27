/**
 * Diagnostics producer for `.flow.ts` files.
 *
 * Two paths surface as `vscode.Diagnostic[]`:
 *
 *   1. **Parse failures** — bad JSON in the footer or a footerless file the
 *      evaluator can't load. Always renders a single top-of-file diagnostic
 *      with the parser's error message. If the parser handed us a `line`
 *      number (the evaluator does for jiti errors), we anchor to that line.
 *
 *   2. **Validation failures** — `FlowValidationError` from `@flowlib/sdk`'s
 *      `defineFlow`. The validator throws on the first problem rather than
 *      collecting, so we get one diagnostic per parse cycle. We try to map
 *      the message back to a node `referenceId` and underline the matching
 *      `referenceId('foo')` literal in the source; missing-source / missing-
 *      target edge errors get range-mapped onto the offending edge tuple.
 *      Mapping is best-effort — when we can't pin a precise range, we
 *      attribute to the top of the file.
 *
 * Pure, dependency-light, easy to test. The lifecycle (per-URI set/clear) is
 * `FlowDiagnosticManager` next door.
 */

import * as vscode from 'vscode';
import type { SdkFlowDefinition } from '@flowlib/sdk';
import { defineFlow, FlowValidationError } from '@flowlib/sdk';

export interface ParseSuccess {
  ok: true;
  flow: SdkFlowDefinition;
  source: 'footer' | 'evaluator';
}
export interface ParseFailure {
  ok: false;
  error: string;
  line?: number;
}
export type ParseResult = ParseSuccess | ParseFailure;

export interface DiagnosticInput {
  document: vscode.TextDocument;
  parseResult: ParseResult;
}

export function produceDiagnostics(input: DiagnosticInput): vscode.Diagnostic[] {
  if (!input.parseResult.ok) {
    return [parseFailureDiagnostic(input.parseResult)];
  }
  return validateAndMap(input.document, input.parseResult.flow);
}

function parseFailureDiagnostic(failure: ParseFailure): vscode.Diagnostic {
  const line = Math.max(0, (failure.line ?? 1) - 1);
  const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
  const d = new vscode.Diagnostic(range, failure.error, vscode.DiagnosticSeverity.Error);
  d.source = 'flowlib';
  d.code = 'parse-error';
  return d;
}

function validateAndMap(doc: vscode.TextDocument, flow: SdkFlowDefinition): vscode.Diagnostic[] {
  try {
    defineFlow(flow);
    return [];
  } catch (e) {
    if (e instanceof FlowValidationError) {
      return [validationDiagnostic(doc, e.message)];
    }
    return [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        `Validation crashed: ${(e as Error).message}`,
        vscode.DiagnosticSeverity.Warning,
      ),
    ];
  }
}

function validationDiagnostic(doc: vscode.TextDocument, message: string): vscode.Diagnostic {
  const range = locateValidationRange(doc, message);
  const d = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  d.source = 'flowlib';
  d.code = 'flow-validation';
  return d;
}

/**
 * Best-effort: pull a `referenceId` out of the validation message and
 * locate it in the source. Patterns we know about:
 *   - `duplicate referenceId "foo"`
 *   - `edge references unknown source "foo"...`
 *   - `edge references unknown target "foo"...`
 *
 * Falls back to the top of the file when nothing matches.
 */
export function locateValidationRange(doc: vscode.TextDocument, message: string): vscode.Range {
  const refMatch = message.match(/(?:referenceId|source|target)\s+"([^"]+)"/);
  if (!refMatch) {
    return new vscode.Range(0, 0, 0, 0);
  }
  const ref = refMatch[1];
  const text = doc.getText();
  // Prefer the literal call-shape `referenceId('foo')`; otherwise `'foo'` or
  // `"foo"` anywhere in the file. Take the first hit. The `ref` value is
  // escaped via `escapeRegExp`, so the dynamic RegExp is safe.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const callShape = new RegExp(`referenceId\\s*[(:]\\s*['"\`]${escapeRegExp(ref)}['"\`]`, 'm');
  let idx = text.search(callShape);
  if (idx < 0) {
    // eslint-disable-next-line security/detect-non-literal-regexp
    const literal = new RegExp(`['"\`]${escapeRegExp(ref)}['"\`]`, 'm');
    idx = text.search(literal);
  }
  if (idx < 0) {
    return new vscode.Range(0, 0, 0, 0);
  }
  const start = doc.positionAt(idx);
  const end = doc.positionAt(idx + ref.length + 2); // +2 for the surrounding quotes
  return new vscode.Range(start, end);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
