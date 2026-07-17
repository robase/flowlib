/**
 * Hybrid retrieval scorer — the fusion half of Mem0's "special sauce".
 *
 * Fuses three signals into one relevance score:
 *   - semantic: cosine similarity, an **absolute** value in [0, 1]
 *   - bm25:     raw SQLite `bm25()` (≤ 0, lower = better), normalised
 *               **within the candidate set** (min-max) — absolute bm25
 *               magnitudes are corpus-dependent and not comparable across
 *               queries, so a relative normalisation is the robust choice
 *               (the design doc's fixed sigmoid was illustrative).
 *   - entity:   optional [0, 1] boost (v2; unused for now)
 *
 * Fusion is additive with an adaptive divisor (1.0 → 2.5 depending on
 * which signals fired). Crucially the **semantic threshold gates before
 * fusion** — a memory that isn't semantically relevant can't be dragged
 * in by a keyword match alone.
 */

import type { MemoryRecord } from './types';

/** Minimum cosine similarity for a memory to be eligible at all. */
export const SEMANTIC_THRESHOLD = 0.5;

const W_SEMANTIC = 1.0;
const W_BM25 = 1.0;
const W_ENTITY = 0.5;

export interface ScoringSignals {
  /** id → cosine similarity (absolute, [0, 1]). */
  semantic: Map<string, number>;
  /** id → raw SQLite bm25 (≤ 0, lower = better). */
  bm25: Map<string, number>;
  /** id → entity boost ([0, 1]); optional. */
  entity?: Map<string, number>;
}

/**
 * Normalise raw bm25 values to [0, 1] within the candidate set —
 * most-negative (best) → 1, least-negative (worst) → 0. A single
 * candidate (or all-equal) normalises to 1 (it matched).
 */
function normaliseBm25(raw: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (raw.size === 0) {
    return out;
  }
  const values = [...raw.values()];
  const min = Math.min(...values); // most negative — best
  const max = Math.max(...values); // least negative — worst
  const span = max - min;
  for (const [id, v] of raw) {
    out.set(id, span === 0 ? 1 : (max - v) / span);
  }
  return out;
}

/**
 * Score + rank candidate rows. Rows below {@link SEMANTIC_THRESHOLD} are
 * dropped before fusion; the rest are scored `(Σ weighted signals) /
 * (Σ weights that fired)` and sorted descending.
 */
export function scoreAndRank(
  rows: ReadonlyArray<MemoryRecord>,
  signals: ScoringSignals,
): MemoryRecord[] {
  const bm25 = normaliseBm25(signals.bm25);
  const scored: MemoryRecord[] = [];

  for (const row of rows) {
    const semantic = signals.semantic.get(row.id) ?? 0;
    if (semantic < SEMANTIC_THRESHOLD) {
      continue; // gate: keyword can't rescue a semantically irrelevant memory
    }

    let combined = W_SEMANTIC * semantic;
    let maxPossible = W_SEMANTIC;

    const kw = bm25.get(row.id);
    if (kw !== undefined) {
      combined += W_BM25 * kw;
      maxPossible += W_BM25;
    }

    const boost = signals.entity?.get(row.id) ?? 0;
    if (boost > 0) {
      combined += W_ENTITY * boost;
      maxPossible += W_ENTITY;
    }

    scored.push({ ...row, score: combined / maxPossible });
  }

  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
