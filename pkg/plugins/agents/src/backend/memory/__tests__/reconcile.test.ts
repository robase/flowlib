import { describe, expect, it } from 'vitest';

import { reconcileFact } from '../reconcile';
import type { MemoryLlm } from '../types';

/** A MemoryLlm that returns one canned JSON response. */
function llmReturning(response: unknown): MemoryLlm {
  return { json: async () => response as never };
}

const candidates = [
  { id: 'uuid-a', text: 'likes cheese pizza' },
  { id: 'uuid-b', text: 'lives in Paris' },
];

describe('reconcileFact', () => {
  it('maps the integer id back to the real UUID for UPDATE', async () => {
    const ops = await reconcileFact(
      llmReturning({
        memory: [{ id: '0', event: 'UPDATE', text: 'loves cheese + chicken pizza' }],
      }),
      'loves cheese and chicken pizza',
      candidates,
    );
    expect(ops).toEqual([{ event: 'UPDATE', id: 'uuid-a', text: 'loves cheese + chicken pizza' }]);
  });

  it('maps the integer id back for DELETE', async () => {
    const ops = await reconcileFact(
      llmReturning({ memory: [{ id: '1', event: 'DELETE' }] }),
      'no longer in Paris',
      candidates,
    );
    expect(ops).toEqual([{ event: 'DELETE', id: 'uuid-b' }]);
  });

  it('passes ADD through with its text', async () => {
    const ops = await reconcileFact(
      llmReturning({ memory: [{ event: 'ADD', text: 'has a dog' }] }),
      'has a dog',
      candidates,
    );
    expect(ops).toEqual([{ event: 'ADD', text: 'has a dog' }]);
  });

  it('respects an explicit NOOP (does not force an ADD)', async () => {
    const ops = await reconcileFact(
      llmReturning({ memory: [{ id: '0', event: 'NOOP' }] }),
      'likes cheese pizza',
      candidates,
    );
    expect(ops).toEqual([{ event: 'NOOP' }]);
  });

  it('drops ops that reference a hallucinated / out-of-range id, defaulting to ADD', async () => {
    const ops = await reconcileFact(
      llmReturning({ memory: [{ id: '9', event: 'UPDATE', text: 'x' }] }),
      'a brand new fact',
      candidates,
    );
    // The bogus UPDATE is dropped → nothing usable → default ADD of the new fact.
    expect(ops).toEqual([{ event: 'ADD', text: 'a brand new fact' }]);
  });

  it('defaults to ADD when the LLM returns nothing usable', async () => {
    const ops = await reconcileFact(llmReturning({ memory: [] }), 'new fact', candidates);
    expect(ops).toEqual([{ event: 'ADD', text: 'new fact' }]);
  });
});
