/**
 * Public types for the agents eval harness.
 *
 * The harness drives the *real* kernel loop (`runTurn`) against an
 * injectable provider, collects the emitted `AgentEvent` stream into a
 * {@link Transcript}, and scores the outcome with a set of {@link Scorer}s.
 *
 * It is provider-agnostic on purpose: pass the scripted provider for
 * offline self-tests, or the real `aiSdkProvider` for live evals. The
 * thing under test is the system prompt + tool surface, not the provider.
 */

import type { AgentEvent } from '../../src/shared/events';
import type { AgentProvider } from '../../src/backend/providers/types';
import type { WorkspaceHandle } from '../../src/backend/workspaces/types';
import type { RunResult } from '../../src/backend/service/types';
import type { Transcript } from './transcript';

/**
 * One scored interaction. The `prompt` is the user's message; everything
 * else configures the agent under test. Iterating on prompt quality means
 * editing `systemPrompt` and re-running the suite.
 */
export interface EvalCase {
  /** Stable id, e.g. `clarify-before-acting`. Used in the report. */
  id: string;
  /** Optional one-line summary of what the case checks. */
  description?: string;
  /** The user's prompt for the single turn under test. */
  prompt: string;
  /**
   * The agent's system prompt — the thing you iterate on. Composed
   * through the real `composeSystemPrompt` (so operating directives,
   * memory, etc. are exercised) unless `rawSystemPrompt` is set.
   */
  systemPrompt?: string;
  /** Skip prompt composition and use this string verbatim as the system prompt. */
  rawSystemPrompt?: string;
  /** Per-turn model override (e.g. `anthropic/claude-sonnet-4-5`). */
  model?: string;
  /** Tools denied for this turn. */
  denyList?: string[];
  /** When set, only these tools are exposed. */
  enabledTools?: string[];
  /** Seed files written into the workspace before the turn (path → contents). */
  files?: Record<string, string>;
  /** Memory excerpts to inject into the composed prompt. */
  memory?: ReadonlyArray<{ scope: string; content: string }>;
  /**
   * Auto-answer for `ask_user` / human-input requests so the turn never
   * hangs. A string, or a function of the agent's question. Defaults to a
   * neutral "proceed" answer. The point of the case is usually whether the
   * agent *asked* (see `askedClarifyingQuestion`), not the answer content.
   */
  humanInput?: string | ((question: string) => string);
  /** Auto-decision for permission requests. Default `allow`. */
  permission?: 'allow' | 'deny';
  /** The checks that decide pass/fail. */
  scorers: Scorer[];
  /** Hard wall-clock cap for the turn (ms). Default 120_000. */
  timeoutMs?: number;
  /**
   * Run the case N times to tame model nondeterminism. Default 1. The case
   * passes if the per-sample pass rate ≥ `minPassRate`.
   */
  samples?: number;
  /**
   * Fraction of samples (0..1) that must pass for the case to pass. Default
   * 1 (every sample must pass). E.g. `samples: 5, minPassRate: 0.6` → ≥3/5.
   */
  minPassRate?: number;
  /**
   * Case needs a real shell/filesystem (the verification loop). The CLI
   * skips it unless run with `--sandbox`, and logs how many were skipped.
   */
  requiresSandbox?: boolean;
}

/** Everything a scorer is handed about one completed run. */
export interface RunOutcome {
  /** The case that produced this run. */
  case: EvalCase;
  /** Collected event stream + convenience accessors. */
  transcript: Transcript;
  /** Aggregate totals from the kernel. */
  result: RunResult;
  /** Wall-clock duration of the turn (ms). */
  durationMs: number;
  /** The workspace handle, for post-run filesystem inspection. */
  workspace: WorkspaceHandle;
  /** The exact system prompt the host composed for this turn. */
  systemPrompt: string;
  /** Stable short hash of `systemPrompt` — the prompt "version" for A/B. */
  promptHash: string;
}

/** Optional services a scorer may use (e.g. an LLM judge client). */
export interface ScorerContext {
  /** Lazily-resolved judge client; throws if not configured. */
  judge: () => Promise<JudgeClient>;
}

/** The verdict from a single scorer. */
export interface Score {
  /** Scorer name, shown per-row in the report. */
  name: string;
  /** Did this check pass? Drives the case's overall pass/fail. */
  passed: boolean;
  /** Normalised 0..1 score for weighted aggregation. */
  score: number;
  /** Relative weight in the case's aggregate score. Default 1. */
  weight?: number;
  /** Human-readable explanation (always populated on failure). */
  detail?: string;
}

/** A check applied to one run. Pure or async (judge scorers hit the network). */
export type Scorer = (outcome: RunOutcome, ctx: ScorerContext) => Score | Promise<Score>;

/**
 * Minimal LLM client the judge scorer needs: text in, text out. The
 * default implementation wires Anthropic via the AI SDK; tests inject a
 * deterministic fake.
 */
export type JudgeClient = (input: {
  system: string;
  prompt: string;
}) => Promise<string>;

/** Result of scoring one case. */
export interface CaseReport {
  case: EvalCase;
  /** Scorer verdicts (from the first sample, representative). */
  scores: Score[];
  /** True iff the case passed (per-sample pass rate ≥ minPassRate). */
  passed: boolean;
  /** Weighted mean of the scorer scores (0..1), averaged across samples. */
  weightedScore: number;
  /** Number of samples run for this case. */
  samples: number;
  /** Fraction of samples that passed (0..1). */
  passRate: number;
  /** Prompt-version hash for the composed system prompt. */
  promptHash?: string;
  durationMs: number;
  /** Set when the run threw before scoring (provider/setup error). */
  error?: string;
  result?: RunOutcome['result'];
}

/** Aggregate over a whole suite run. */
export interface SuiteReport {
  cases: CaseReport[];
  total: number;
  passed: number;
  failed: number;
  errored: number;
  /** Mean weighted score across cases that ran. */
  meanScore: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** How to run a suite. */
export interface RunOptions {
  /** Provider under test (scripted for self-tests, ai-sdk for live). */
  provider: AgentProvider;
  /** Factory for a fresh workspace per case (and per sample). */
  createWorkspace: () => WorkspaceHandle | Promise<WorkspaceHandle>;
  /** Tear down a workspace after a sample finishes (e.g. remove a container). */
  destroyWorkspace?: (workspace: WorkspaceHandle) => void | Promise<void>;
  /** Judge client for `llmJudge` scorers. Optional until a case needs one. */
  judge?: JudgeClient;
  /** Default model when a case omits one. */
  defaultModel?: string;
  /** Max cases run concurrently. Default 1 (sequential). */
  concurrency?: number;
  /** Called as each case finishes, for live progress output. */
  onCaseComplete?: (report: CaseReport) => void;
}
