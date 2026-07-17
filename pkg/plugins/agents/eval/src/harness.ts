/**
 * The harness — runs one eval case (or a whole suite) against the real
 * host path.
 *
 * It drives `runChatTurn` — the same function the Express SSE endpoint and
 * the Cloudflare Durable Object call — not a hand-rolled loop. That means
 * an eval exercises the production tool surface (`buildProviderTools`
 * wires `web.fetch`, `ask_user`, `memory.*`, `update_plan`), the real
 * decision gate, and production-identical prompt composition. The harness
 * only swaps the provider, in-memory repositories, the emit sink (a
 * transcript collector), and an auto-responder for human-input /
 * permission requests so turns don't block.
 *
 * Flow per sample:
 *   1. seed a fresh workspace with `case.files`
 *   2. build in-memory repositories + a session row carrying the system
 *      prompt / model / deny-list under test
 *   3. `runChatTurn(deps, case.prompt)` — composes the prompt (captured for
 *      its version hash), creates the provider session, drives the loop
 *   4. score the transcript + post-run workspace
 *
 * A case may request `samples > 1`; the case passes when the per-sample
 * pass rate meets `minPassRate` (default 1.0), which tames model
 * nondeterminism.
 */

import {
  createDecisionGate,
  createInMemoryPromptCache,
  runChatTurn,
  type ChatHostDeps,
} from '../../src/backend/service/chat-session-host';
import { createAgentService } from '../../src/backend/service/agent-service';
import { composeSystemPrompt } from '../../src/backend/prompt/compose';
import type { SessionLogger } from '../../src/backend/service/types';
import type { AgentEvent } from '../../src/shared/events';
import type { WorkspaceProviderId } from '../../src/backend/workspaces/types';
import { InMemoryWorkspace } from './workspaces/memory';
import { Transcript } from './transcript';
import { createEvalRepositories, createEvalWorkspaceProvider, EVAL_AUTH } from './fakes';
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
const EVAL_WORKSPACE_PROVIDER_ID: WorkspaceProviderId = 'local-fs';

/** A logger that drops everything — keeps eval output to the report only. */
const silentLogger: SessionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Resolve the auto-answer for `ask_user` / human-input from the case. */
function humanInputAnswer(c: EvalCase): (question: string) => string {
  const cfg = c.humanInput;
  if (typeof cfg === 'function') {
    return cfg;
  }
  const fixed = cfg ?? 'Use your best judgement and proceed.';
  return () => fixed;
}

/** FNV-1a 32-bit → 8-hex-char hash. Dependency-free, stable prompt "version". */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Run one sample of a case end-to-end and return its raw outcome (pre-scoring). */
export async function runCaseRaw(
  c: EvalCase,
  opts: Pick<RunOptions, 'provider' | 'createWorkspace' | 'destroyWorkspace' | 'defaultModel'>,
): Promise<RunOutcome> {
  // 1. Fresh workspace, seeded with the case's files (any handle type).
  const workspace = (await opts.createWorkspace?.()) ?? new InMemoryWorkspace(`eval-${c.id}`);
  if (c.files) {
    for (const [path, content] of Object.entries(c.files)) {
      await workspace.writeFile(path, content);
    }
  }

  const transcript = new Transcript();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), c.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const gate = createDecisionGate();
  controller.signal.addEventListener(
    'abort',
    () => gate.rejectAll(new Error('eval turn aborted')),
    { once: true },
  );

  const sessionId = `eval-${c.id}`;
  const providerSessionId = `eval-${c.id}-${jitter()}`;
  const workspaceId = `eval-ws-${c.id}`;

  const repositories = createEvalRepositories({
    session: {
      id: sessionId,
      providerId: opts.provider.id,
      providerSessionId,
      orgId: EVAL_AUTH.orgId,
      workspaceId,
      model: c.model ?? opts.defaultModel ?? null,
      systemPrompt: c.systemPrompt ?? null,
      denyList: c.denyList ?? null,
      enabledTools: c.enabledTools ?? null,
    },
    workspaceProviderId: EVAL_WORKSPACE_PROVIDER_ID,
    ...(c.memory ? { memory: c.memory } : {}),
  });

  // Auto-responder: resolve human-input / permission requests on a macro-
  // task so the provider's `await gate.await*` has registered first (the
  // tool emits the event, *then* awaits — a microtask would race it).
  const answer = humanInputAnswer(c);
  const allowPermission = c.permission !== 'deny';
  const emit = (event: AgentEvent): void => {
    transcript.record(event);
    if (event.type === 'human-input-request') {
      setTimeout(() => gate.resolveHumanInput(event.id, { answer: answer(event.prompt) }), 0);
    } else if (event.type === 'permission-request') {
      setTimeout(() => gate.resolvePermission(event.id, { allowed: allowPermission }), 0);
    }
  };

  // Capture the exact composed prompt by wrapping the composer the host
  // uses. `rawSystemPrompt` short-circuits composition entirely.
  let systemPrompt = '';
  const composer: ChatHostDeps['composeSystemPrompt'] = async (input) => {
    systemPrompt =
      c.rawSystemPrompt !== undefined ? c.rawSystemPrompt : await composeSystemPrompt(input);
    return systemPrompt;
  };

  const deps: ChatHostDeps & { agentService: ReturnType<typeof createAgentService> } = {
    sessionId,
    orgId: EVAL_AUTH.orgId,
    auth: EVAL_AUTH,
    providers: new Map([[opts.provider.id, opts.provider]]),
    workspaces: new Map([
      [
        EVAL_WORKSPACE_PROVIDER_ID,
        createEvalWorkspaceProvider(EVAL_WORKSPACE_PROVIDER_ID, workspace),
      ],
    ]),
    repositories,
    emit,
    logger: silentLogger,
    abortSignal: controller.signal,
    promptCache: createInMemoryPromptCache(),
    decisionGate: gate,
    agentService: createAgentService(),
    composeSystemPrompt: composer,
  };

  const startedAt = Date.now();
  try {
    const out = await runChatTurn(deps, c.prompt);
    if ('error' in out) {
      throw new Error(`${out.error.code}: ${out.error.message}`);
    }
    // On success the *caller* owns teardown — scorers like `commandSucceeds`
    // need to exec in this workspace after we return, so it must outlive us.
    return {
      case: c,
      transcript,
      result: out.result,
      durationMs: Date.now() - startedAt,
      workspace,
      systemPrompt,
      promptHash: shortHash(systemPrompt),
    };
  } catch (err) {
    // Failure path: nothing downstream will inspect the workspace, so clean
    // it up here (a container would otherwise leak).
    await opts.destroyWorkspace?.(workspace);
    throw err;
  } finally {
    clearTimeout(timeout);
    gate.rejectAll(new Error('eval turn finished'));
  }
}

/** Score one outcome against a case's scorers. */
async function scoreOutcome(
  outcome: RunOutcome,
  scorers: EvalCase['scorers'],
  ctx: ScorerContext,
): Promise<{ scores: Score[]; passed: boolean; weightedScore: number }> {
  const scores: Score[] = [];
  for (const scorer of scorers) {
    try {
      scores.push(await scorer(outcome, ctx));
    } catch (err) {
      scores.push({
        name: scorer.name || 'scorer',
        passed: false,
        score: 0,
        detail: `scorer threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return {
    scores,
    passed: scores.length > 0 && scores.every((s) => s.passed),
    weightedScore: weightedMean(scores),
  };
}

/** Run one case (all its samples) and aggregate into a report. */
export async function runCase(c: EvalCase, opts: RunOptions): Promise<CaseReport> {
  const scorerCtx: ScorerContext = { judge: async () => requireJudge(opts.judge) };
  const samples = Math.max(1, c.samples ?? 1);
  const minPassRate = c.minPassRate ?? 1;

  const sampleResults: Array<{
    passed: boolean;
    weightedScore: number;
    scores: Score[];
    durationMs: number;
    result?: RunOutcome['result'];
    promptHash: string;
  }> = [];

  for (let i = 0; i < samples; i++) {
    let outcome: RunOutcome;
    try {
      outcome = await runCaseRaw(c, opts);
    } catch (err) {
      const report: CaseReport = {
        case: c,
        scores: [],
        passed: false,
        weightedScore: 0,
        samples,
        passRate: 0,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      opts.onCaseComplete?.(report);
      return report;
    }
    try {
      const scored = await scoreOutcome(outcome, c.scorers, scorerCtx);
      sampleResults.push({
        ...scored,
        durationMs: outcome.durationMs,
        result: outcome.result,
        promptHash: outcome.promptHash,
      });
    } finally {
      // Teardown after scoring so `commandSucceeds` & friends can exec.
      await opts.destroyWorkspace?.(outcome.workspace);
    }
  }

  const passedCount = sampleResults.filter((s) => s.passed).length;
  const passRate = passedCount / samples;
  const report: CaseReport = {
    case: c,
    // Representative scores: prefer the first failing sample so the report
    // surfaces *why* a flaky case fails; otherwise the first sample.
    scores: (sampleResults.find((s) => !s.passed) ?? sampleResults[0]).scores,
    passed: passRate >= minPassRate,
    weightedScore: sampleResults.reduce((a, s) => a + s.weightedScore, 0) / samples,
    samples,
    passRate,
    promptHash: sampleResults[0]?.promptHash,
    durationMs: sampleResults.reduce((a, s) => a + s.durationMs, 0),
    result: sampleResults[sampleResults.length - 1]?.result,
  };
  opts.onCaseComplete?.(report);
  return report;
}

/** Run a suite of cases with bounded concurrency, preserving input order. */
export async function runSuite(cases: EvalCase[], opts: RunOptions): Promise<SuiteReport> {
  const limit = Math.max(1, opts.concurrency ?? 1);
  const reports = await mapWithConcurrency(cases, limit, (c) => runCase(c, opts));
  return aggregate(reports);
}

// ─── helpers ─────────────────────────────────────────────────────────

/** Run `fn` over `items` with at most `limit` in flight; results keep order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

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

/** Small non-crypto counter for unique session ids (portable across runtimes). */
let counter = 0;
function jitter(): string {
  counter += 1;
  return `${counter}`;
}
