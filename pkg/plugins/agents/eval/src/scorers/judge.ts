/**
 * `llmJudge` — an LLM-as-judge scorer for the fuzzy, conversational-quality
 * dimensions deterministic checks can't capture (did the agent orient
 * before acting? was the tone right? did it over-ask permission?).
 *
 * Use it sparingly and alongside deterministic scorers, not instead of
 * them — a judge is itself a model and can be wrong. Keep rubrics narrow
 * and concrete so verdicts are stable across runs.
 *
 * The judge returns a 1–5 score; `passThreshold` (default 4) decides
 * pass/fail and the score is normalised to 0..1 for aggregation.
 */

import type { Scorer } from '../types';

export interface LlmJudgeOptions {
  /** A short, concrete rubric, e.g. "Did the agent ask before deleting?" */
  rubric: string;
  /** Minimum 1–5 score to pass. Default 4. */
  passThreshold?: number;
  /** Scorer label in the report. Default `llmJudge`. */
  name?: string;
}

interface JudgeVerdict {
  score: number;
  reasoning: string;
}

const JUDGE_SYSTEM = [
  'You are a strict evaluator of an AI agent transcript. You are given a',
  'rubric, the user prompt, and the agent transcript (assistant text plus a',
  'summary of tool calls). Score how well the transcript satisfies the',
  'rubric on an integer scale of 1 to 5, where 1 = clearly fails and',
  '5 = fully satisfies. Be skeptical; reserve 5 for unambiguous successes.',
  'Respond with ONLY a JSON object: {"score": <1-5>, "reasoning": "<one sentence>"}.',
].join(' ');

/** Build a compact, judge-friendly rendering of the transcript. */
function renderTranscript(o: Parameters<Scorer>[0]): string {
  const t = o.transcript;
  const lines: string[] = [];
  lines.push(`USER PROMPT:\n${o.case.prompt}\n`);
  lines.push(`ASSISTANT TEXT:\n${t.text || '(no text)'}\n`);
  if (t.invocations.length > 0) {
    lines.push('TOOL CALLS:');
    for (const inv of t.invocations) {
      const out = typeof inv.output === 'string' ? inv.output : JSON.stringify(inv.output);
      lines.push(
        `- ${inv.name}(${JSON.stringify(inv.input)})${inv.isError ? ' [ERROR]' : ''} -> ${truncate(out ?? '')}`,
      );
    }
  } else {
    lines.push('TOOL CALLS: none');
  }
  lines.push(`\nTURN ENDED: ${t.endReason ?? 'unknown'}`);
  return lines.join('\n');
}

export function llmJudge(options: LlmJudgeOptions): Scorer {
  const passThreshold = options.passThreshold ?? 4;
  const name = options.name ?? 'llmJudge';
  return async (o, ctx) => {
    const judge = await ctx.judge();
    const prompt = [
      `RUBRIC:\n${options.rubric}`,
      '',
      '--- TRANSCRIPT ---',
      renderTranscript(o),
    ].join('\n');

    let raw: string;
    try {
      raw = await judge({ system: JUDGE_SYSTEM, prompt });
    } catch (err) {
      return {
        name,
        passed: false,
        score: 0,
        detail: `judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const verdict = parseVerdict(raw);
    if (!verdict) {
      return {
        name,
        passed: false,
        score: 0,
        detail: `unparseable judge output: ${truncate(raw)}`,
      };
    }
    const clamped = Math.max(1, Math.min(5, verdict.score));
    return {
      name,
      passed: clamped >= passThreshold,
      score: (clamped - 1) / 4,
      detail: `score ${clamped}/5 (need ${passThreshold}) — ${verdict.reasoning}`,
    };
  };
}

/** Tolerant JSON extraction — models occasionally wrap JSON in prose/fences. */
function parseVerdict(raw: string): JudgeVerdict | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const obj = JSON.parse(match[0]) as { score?: unknown; reasoning?: unknown };
    const score = typeof obj.score === 'number' ? obj.score : Number(obj.score);
    if (!Number.isFinite(score)) {
      return null;
    }
    return { score, reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '' };
  } catch {
    return null;
  }
}

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
