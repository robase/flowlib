/**
 * The harness — runs one eval case (or a whole suite) against the real
 * kernel loop.
 *
 * Flow per case:
 *   1. seed a fresh workspace with `case.files`
 *   2. compose the system prompt through the *real* `composeSystemPrompt`
 *      (so operating directives / memory are exercised) unless the case
 *      supplies `rawSystemPrompt`
 *   3. `provider.createSession({ systemPrompt, ... })`
 *   4. drive `runTurn(ctx, prompt)`, collecting events into a `Transcript`
 *   5. score the outcome with the case's scorers
 *
 * The kernel is the same `runTurn` production uses — the harness only
 * swaps the provider, the persistence callbacks (no-ops here), and the
 * emit sink (the transcript collector). That fidelity is the point: an
 * eval green here means the real loop behaves.
 */

import { runTurn } from '../../src/backend/service/run-turn';
import type {
  PersistenceCallbacks,
  SessionContext,
  SessionLogger,
} from '../../src/backend/service/types';
import type { PromptInput } from '../../src/backend/providers/types';
import type { AgentsAuthContext } from '../../src/shared/auth-context';
import { noopHookPipeline } from '../../src/backend/hooks/types';
import { allowAllResolver } from '../../src/backend/permissions/types';
import { composeSystemPrompt } from '../../src/backend/prompt/compose';
import { InMemoryWorkspace } from './workspaces/memory';
import { Transcript } from './transcript';
import type {
  CaseReport,
  EvalCase,
  JudgeClient,
  RunOptions,
  RunOutcome,
  Score,
  ScorerContext,
  SuiteReport,
} from './types';

const DEFAULT_TIMEOUT_MS = 120_000;

const EVAL_AUTH: AgentsAuthContext = {
  userId: 'eval-user',
  orgId: 'eval-org',
  role: 'admin',
  teamIds: [],
};

/** A logger that drops everything — keeps eval output to the report only. */
const silentLogger: SessionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Persistence is irrelevant to scoring; the transcript captures the run. */
const noopCallbacks: PersistenceCallbacks = {
  onMessageStart: async () => {},
  onTextDelta: async () => {},
  onToolCall: async () => {},
  onToolResult: async () => {},
  onFileEdit: async () => {},
  onMessageComplete: async () => {},
  onTurnEnd: async () => {},
};

/** Compose the system prompt for a case (or pass `rawSystemPrompt` through). */
async function buildSystemPrompt(c: EvalCase): Promise<string> {
  if (c.rawSystemPrompt !== undefined) {
    return c.rawSystemPrompt;
  }
  return composeSystemPrompt({
    systemPrompt: c.systemPrompt ?? '',
    skillSummaries: [],
    denyList: c.denyList ?? [],
    availableTools: [],
    memory: c.memory ?? [],
    attachments: [],
  });
}

/** Run a single case end-to-end and return its raw outcome (pre-scoring). */
export async function runCaseRaw(
  c: EvalCase,
  opts: Omit<RunOptions, 'onCaseComplete'>,
): Promise<RunOutcome> {
  const workspace =
    (await opts.createWorkspace?.()) ?? new InMemoryWorkspace(`eval-${c.id}`, c.files);
  // Seed files when the provided workspace is our in-memory one.
  if (workspace instanceof InMemoryWorkspace && c.files) {
    for (const [path, content] of Object.entries(c.files)) {
      await workspace.writeFile(path, content);
    }
  }

  const systemPrompt = await buildSystemPrompt(c);
  const transcript = new Transcript();

  const providerSessionId = `eval-${c.id}-${jitter()}`;
  await opts.provider.createSession({
    auth: EVAL_AUTH,
    config: {},
    systemPrompt,
    providerSessionId,
    workspace,
  } as Parameters<typeof opts.provider.createSession>[0]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), c.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const ctx: SessionContext = {
    sessionId: `eval-${c.id}`,
    providerSessionId,
    auth: EVAL_AUTH,
    provider: opts.provider,
    workspace,
    hooks: noopHookPipeline,
    permissions: allowAllResolver,
    logger: silentLogger,
    callbacks: noopCallbacks,
    emit: (event) => transcript.record(event),
    abortSignal: controller.signal,
    defaultModel: c.model ?? opts.defaultModel,
    ...(c.denyList ? { denyList: c.denyList } : {}),
    ...(c.enabledTools ? { enabledTools: c.enabledTools } : {}),
  };

  const promptInput: PromptInput = {
    providerSessionId,
    parts: [{ type: 'text', text: c.prompt }],
    abortSignal: controller.signal,
    ...(ctx.defaultModel ? { model: ctx.defaultModel } : {}),
    ...(c.denyList ? { extraDenied: c.denyList } : {}),
    ...(c.enabledTools ? { enabledTools: c.enabledTools } : {}),
  };

  const startedAt = Date.now();
  try {
    const result = await runTurn(ctx, promptInput);
    return { case: c, transcript, result, durationMs: Date.now() - startedAt, workspace };
  } finally {
    clearTimeout(timeout);
  }
}

/** Run one case and score it. Setup/provider errors are captured, not thrown. */
export async function runCase(c: EvalCase, opts: RunOptions): Promise<CaseReport> {
  const scorerCtx: ScorerContext = {
    judge: async () => requireJudge(opts.judge),
  };

  let outcome: RunOutcome;
  try {
    outcome = await runCaseRaw(c, opts);
  } catch (err) {
    const report: CaseReport = {
      case: c,
      scores: [],
      passed: false,
      weightedScore: 0,
      durationMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    opts.onCaseComplete?.(report);
    return report;
  }

  const scores: Score[] = [];
  for (const scorer of c.scorers) {
    try {
      scores.push(await scorer(outcome, scorerCtx));
    } catch (err) {
      scores.push({
        name: scorer.name || 'scorer',
        passed: false,
        score: 0,
        detail: `scorer threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const report: CaseReport = {
    case: c,
    scores,
    passed: scores.length > 0 && scores.every((s) => s.passed),
    weightedScore: weightedMean(scores),
    durationMs: outcome.durationMs,
    result: outcome.result,
  };
  opts.onCaseComplete?.(report);
  return report;
}

/** Run a suite of cases sequentially and aggregate. */
export async function runSuite(cases: EvalCase[], opts: RunOptions): Promise<SuiteReport> {
  const reports: CaseReport[] = [];
  for (const c of cases) {
    reports.push(await runCase(c, opts));
  }
  return aggregate(reports);
}

// ─── helpers ─────────────────────────────────────────────────────────

function weightedMean(scores: Score[]): number {
  if (scores.length === 0) {
    return 0;
  }
  let weighted = 0;
  let totalWeight = 0;
  for (const s of scores) {
    const w = s.weight ?? 1;
    weighted += s.score * w;
    totalWeight += w;
  }
  return totalWeight === 0 ? 0 : weighted / totalWeight;
}

function aggregate(reports: CaseReport[]): SuiteReport {
  const ran = reports.filter((r) => !r.error);
  const passed = reports.filter((r) => r.passed).length;
  const errored = reports.filter((r) => r.error).length;
  return {
    cases: reports,
    total: reports.length,
    passed,
    failed: reports.length - passed - errored,
    errored,
    meanScore: ran.length === 0 ? 0 : ran.reduce((a, r) => a + r.weightedScore, 0) / ran.length,
    totalDurationMs: reports.reduce((a, r) => a + r.durationMs, 0),
    totalInputTokens: reports.reduce((a, r) => a + (r.result?.inputTokensTotal ?? 0), 0),
    totalOutputTokens: reports.reduce((a, r) => a + (r.result?.outputTokensTotal ?? 0), 0),
  };
}

function requireJudge(judge: JudgeClient | undefined): JudgeClient {
  if (!judge) {
    throw new Error(
      'This case uses an llmJudge scorer but no judge client was configured. ' +
        'Pass `judge` to runSuite/runCase (the CLI wires it from ANTHROPIC_API_KEY).',
    );
  }
  return judge;
}

/** Small non-crypto jitter for unique session ids (crypto-free for portability). */
let counter = 0;
function jitter(): string {
  counter += 1;
  return `${counter}`;
}
