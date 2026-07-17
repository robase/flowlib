import { describe, expect, it } from 'vitest';

import { scoreAndRank } from '../scoring';
import type { MemoryRecord } from '../types';

const row = (id: string): MemoryRecord => ({ id, text: id, scope: { orgId: 'o' } });

describe('scoreAndRank', () => {
  it('gates out rows below the semantic threshold before fusion', () => {
    const out = scoreAndRank([row('a'), row('b')], {
      semantic: new Map([
        ['a', 0.49], // below 0.5 → dropped
        ['b', 0.51],
      ]),
      bm25: new Map(),
    });
    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it('a keyword-only match cannot be dragged in past the gate', () => {
    const out = scoreAndRank([row('a')], {
      semantic: new Map([['a', 0.1]]), // semantically irrelevant
      bm25: new Map([['a', -100]]), // strong keyword hit
    });
    expect(out).toHaveLength(0);
  });

  it('bm25 boosts ordering among semantically-eligible rows', () => {
    const out = scoreAndRank([row('a'), row('b')], {
      semantic: new Map([
        ['a', 0.6],
        ['b', 0.6],
      ]),
      // a has the stronger (more negative) bm25 → normalises to 1, b to 0.
      bm25: new Map([
        ['a', -5],
        ['b', -1],
      ]),
    });
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out[0].score).toBeCloseTo((0.6 + 1) / 2); // (W·sem + W·bm25)/divisor
    expect(out[1].score).toBeCloseTo((0.6 + 0) / 2);
  });

  it('semantic-only rows score on the 1.0 divisor', () => {
    const out = scoreAndRank([row('a')], {
      semantic: new Map([['a', 0.8]]),
      bm25: new Map(),
    });
    expect(out[0].score).toBeCloseTo(0.8);
  });

  it('entity boost widens the divisor and lifts the score', () => {
    const out = scoreAndRank([row('a')], {
      semantic: new Map([['a', 0.6]]),
      bm25: new Map(),
      entity: new Map([['a', 1]]),
    });
    // (1·0.6 + 0.5·1) / (1 + 0.5)
    expect(out[0].score).toBeCloseTo((0.6 + 0.5) / 1.5);
  });
});
