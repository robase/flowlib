/**
 * Parse a `.flow.ts` file into an `SdkFlowDefinition`.
 *
 * The TypeScript source is canonical — we evaluate it via
 * `@flowlib/sdk/evaluator` (which uses jiti to transpile + run the file
 * and returns the value the module's `defineFlow(...)` call produced).
 * No JSON footer is read or written; removing a node in the TS source
 * means it's gone from the canvas as soon as the file parses.
 *
 * Untrusted workspaces can't run the evaluator (it executes user code).
 * In that case we surface a clear error so the host can show a banner
 * prompting the user to trust the workspace.
 */

import type { SdkFlowDefinition } from '@flowlib/sdk';

export interface ParseSuccess {
  ok: true;
  flow: SdkFlowDefinition;
  /**
   * Where the definition came from. Always `'evaluator'` now — kept
   * for back-compat with existing callers that branch on it.
   */
  source: 'evaluator';
}

export interface ParseFailure {
  ok: false;
  error: string;
  /** Optional 1-based line number for diagnostics integration. */
  line?: number;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ParseOptions {
  /**
   * `vscode.workspace.isTrusted`. When `false`, the evaluator is
   * skipped and a `ParseFailure` with a trust-prompt message is
   * returned instead — running user TS in an untrusted workspace
   * would defeat VSCode's sandboxing.
   */
  trusted: boolean;
}

export async function parseFlowFile(src: string, opts: ParseOptions): Promise<ParseResult> {
  if (!opts.trusted) {
    return {
      ok: false,
      error:
        'Cannot evaluate .flow.ts in an untrusted workspace. Trust this workspace to enable the visual editor.',
    };
  }

  try {
    const { evaluateSdkSource } = await import('@flowlib/sdk/evaluator');
    const result = await evaluateSdkSource(src);
    if (!result.ok || !result.flow) {
      const first = result.errors?.[0];
      return {
        ok: false,
        error: first
          ? `Flow evaluation failed: ${first.message}`
          : 'Flow evaluation failed: unknown error',
      };
    }
    // EvaluatedFlow is the structural shape of an SdkFlowDefinition
    // (nodes + edges + optional metadata) — same thing `defineFlow`
    // returns to the user's TS module.
    return {
      ok: true,
      flow: result.flow as unknown as SdkFlowDefinition,
      source: 'evaluator',
    };
  } catch (e) {
    return {
      ok: false,
      error: `Flow evaluation failed: ${(e as Error).message}`,
    };
  }
}
