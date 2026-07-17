import { describe, expect, it } from 'vitest';

import { contentHash } from '../hash';
import { extractFacts } from '../extract';
import { scopeMatches } from '../types';
import type { MemoryLlm } from '../types';

describe('contentHash', () => {
  it('is stable for the same input', () => {
    expect(contentHash('hello world')).toBe(contentHash('hello world'));
  });
  it('differs for different inputs', () => {
    expect(contentHash('hello world')).not.toBe(contentHash('hello world!'));
  });
  it('is 8 hex chars', () => {
    expect(contentHash('anything')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('scopeMatches', () => {
  const org = (orgId: string | null, extra: Record<string, string> = {}) => ({ orgId, ...extra });
  it('requires the same org', () => {
    expect(scopeMatches(org('a'), org('b'))).toBe(false);
    expect(scopeMatches(org('a'), org('a'))).toBe(true);
  });
  it('org-global memory (no userId) is visible to any user in the org', () => {
    expect(scopeMatches(org('a'), org('a', { userId: 'u1' }))).toBe(true);
  });
  it('a user-owned memory is hidden from other users and from org-wide queries', () => {
    expect(scopeMatches(org('a', { userId: 'u1' }), org('a', { userId: 'u2' }))).toBe(false);
    expect(scopeMatches(org('a', { userId: 'u1' }), org('a'))).toBe(false);
    expect(scopeMatches(org('a', { userId: 'u1' }), org('a', { userId: 'u1' }))).toBe(true);
  });
});

function llmReturning(response: unknown): MemoryLlm {
  return { json: async () => response as never };
}

describe('extractFacts', () => {
  const msgs = [{ role: 'user', content: 'hi' }];

  it('returns validated facts', async () => {
    const facts = await extractFacts(
      llmReturning({ facts: [{ text: 'User likes tea', entities: ['tea'] }] }),
      msgs,
      '2026-01-01',
    );
    expect(facts).toEqual([{ text: 'User likes tea', entities: ['tea'] }]);
  });

  it('drops blank / malformed facts', async () => {
    const facts = await extractFacts(
      llmReturning({ facts: [{ text: '  ' }, { text: 'keep me' }, { notText: 1 }] }),
      msgs,
      '2026-01-01',
    );
    expect(facts).toEqual([{ text: 'keep me' }]);
  });

  it('returns [] on a non-conforming response', async () => {
    expect(await extractFacts(llmReturning({}), msgs, '2026-01-01')).toEqual([]);
    expect(await extractFacts(llmReturning({ facts: 'nope' }), msgs, '2026-01-01')).toEqual([]);
  });
});
