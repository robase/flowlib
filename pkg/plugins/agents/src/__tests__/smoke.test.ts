/**
 * Trivial smoke test verifying the @cloudflare/vitest-pool-workers
 * runtime boots correctly.
 *
 * Phase 1 Stream H lands the real Durable Object tests against this
 * pool. For Phase 0 we only need to prove the test runner is wired up.
 */
import { describe, it, expect } from 'vitest';

describe('pool-workers boot smoke', () => {
  it('runs in the workerd runtime', () => {
    // crypto.subtle is available in Workers but not in plain Node before
    // 19 — its presence is a quick proxy for "we are inside workerd".
    expect(typeof crypto.subtle).toBe('object');
    expect(1 + 1).toBe(2);
  });
});
