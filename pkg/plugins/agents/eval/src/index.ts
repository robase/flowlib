/**
 * `@flowlib/agents` eval harness — public surface.
 *
 * Drive the real kernel loop against a provider, collect a transcript,
 * score it. Author cases with `defineEvalCase`, score with the scorers,
 * run with `runSuite` (or the `eval/src/run.ts` CLI).
 */

export type {
  EvalCase,
  RunOutcome,
  RunOptions,
  Score,
  Scorer,
  ScorerContext,
  JudgeClient,
  CaseReport,
  SuiteReport,
} from './types';

export { Transcript, normaliseToolName } from './transcript';
export type { ToolInvocation } from './transcript';

export { runCase, runCaseRaw, runSuite } from './harness';

export { InMemoryWorkspace } from './workspaces/memory';
export { createScriptedProvider, scriptTurn } from './providers/scripted';
export type { Script } from './providers/scripted';
export { createLiveProvider, createAnthropicJudge } from './providers/ai-sdk';
export type { LiveProviderOptions } from './providers/ai-sdk';

export * from './scorers';
export { printReport, toJSON } from './report';

import type { EvalCase } from './types';

/** Identity helper for authoring cases with full type-checking + inference. */
export function defineEvalCase(c: EvalCase): EvalCase {
  return c;
}

/** Define a group of cases in one file. */
export function defineEvalCases(cases: EvalCase[]): EvalCase[] {
  return cases;
}
