/**
 * Report rendering — a console summary for humans and a JSON blob for
 * machines (trend tracking, CI artifacts, prompt-version A/B diffs).
 */

import type { CaseReport, SuiteReport } from './types';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function color(on: boolean): boolean {
  return on && process.stdout.isTTY === true;
}

/** Pretty-print a suite report to stdout. */
export function printReport(suite: SuiteReport, opts: { colors?: boolean } = {}): void {
  const c = color(opts.colors ?? true);
  const g = (s: string) => (c ? `${GREEN}${s}${RESET}` : s);
  const r = (s: string) => (c ? `${RED}${s}${RESET}` : s);
  const d = (s: string) => (c ? `${DIM}${s}${RESET}` : s);
  const b = (s: string) => (c ? `${BOLD}${s}${RESET}` : s);

  // eslint-disable-next-line no-console
  const log = console.log;
  log('');
  log(b('  Agent eval results'));
  log(d('  ─────────────────────────────────────────────────────────'));

  for (const cr of suite.cases) {
    const mark = cr.error ? r('ERROR') : cr.passed ? g('PASS') : r('FAIL');
    const score = cr.error ? '' : d(` ${(cr.weightedScore * 100).toFixed(0)}%`);
    log(`  ${mark} ${cr.case.id}${score} ${d(`${cr.durationMs}ms`)}`);
    if (cr.error) {
      log(`       ${r(cr.error)}`);
      continue;
    }
    for (const s of cr.scores) {
      const m = s.passed ? g('✓') : r('✗');
      const detail = s.detail && !s.passed ? d(` — ${s.detail}`) : '';
      log(`       ${m} ${s.name}${detail}`);
    }
  }

  log(d('  ─────────────────────────────────────────────────────────'));
  const summary = `  ${suite.passed}/${suite.total} passed`;
  log(
    `${suite.failed + suite.errored === 0 ? g(summary) : r(summary)}` +
      d(
        `  ·  mean ${(suite.meanScore * 100).toFixed(0)}%` +
          `  ·  ${suite.totalDurationMs}ms` +
          `  ·  ${suite.totalInputTokens}+${suite.totalOutputTokens} tok`,
      ),
  );
  log('');
}

/** Serialise a suite report to a stable JSON shape (drops scorer fns). */
export function toJSON(suite: SuiteReport): unknown {
  return {
    total: suite.total,
    passed: suite.passed,
    failed: suite.failed,
    errored: suite.errored,
    meanScore: suite.meanScore,
    totalDurationMs: suite.totalDurationMs,
    totalInputTokens: suite.totalInputTokens,
    totalOutputTokens: suite.totalOutputTokens,
    cases: suite.cases.map(serialiseCase),
  };
}

function serialiseCase(cr: CaseReport): unknown {
  return {
    id: cr.case.id,
    description: cr.case.description,
    passed: cr.passed,
    weightedScore: cr.weightedScore,
    durationMs: cr.durationMs,
    error: cr.error,
    scores: cr.scores.map((s) => ({
      name: s.name,
      passed: s.passed,
      score: s.score,
      detail: s.detail,
    })),
    result: cr.result,
  };
}
