/// <reference types="@cloudflare/workers-types" />
/**
 * Tests for `tenantScopedId` and `tenantScopedName`.
 *
 * These are pure helpers, so they happily run inside the
 * `vitest-pool-workers` runtime alongside the DO tests, but the
 * assertions don't actually need any Workers globals.
 */

import { describe, expect, it } from 'vitest';

import { tenantScopedId, tenantScopedName } from '../tenant-scoped-id';
import type { AgentsAuthContext } from '../../../shared/auth-context';

/**
 * Stub of the slice of `Env` the helper needs. We only need `idFromName`
 * since the helper never reaches further into the namespace.
 */
function makeEnv() {
  const calls: string[] = [];
  return {
    calls,
    env: {
      AgentChatDO: {
        idFromName(name: string) {
          calls.push(name);
          // Return a sentinel object that mimics a `DurableObjectId`'s
          // `toString` so equality checks via string remain useful.
          return {
            toString: () => `id:${name}`,
            equals(other: { toString: () => string }) {
              return this.toString() === other.toString();
            },
            name: () => name,
          } as unknown as DurableObjectId;
        },
      } as unknown as DurableObjectNamespace,
    },
  };
}

const baseAuth: AgentsAuthContext = {
  userId: 'u1',
  orgId: 'org-a',
  role: 'user',
  teamIds: [],
};

describe('tenantScopedName', () => {
  it('produces the org-prefixed canonical name', () => {
    expect(tenantScopedName('chat', 'org-a', 'sess-1')).toBe('org:org-a/kind:chat/sess-1');
  });

  it('rejects empty orgId', () => {
    expect(() => tenantScopedName('chat', '', 'sess-1')).toThrow(/orgId required/);
    expect(() => tenantScopedName('chat', '   ', 'sess-1')).toThrow(/orgId required/);
  });

  it('rejects empty suffix', () => {
    expect(() => tenantScopedName('chat', 'org-a', '')).toThrow(/suffix required/);
    expect(() => tenantScopedName('chat', 'org-a', '   ')).toThrow(/suffix required/);
  });

  it('treats the kind as opaque so future DO kinds work', () => {
    expect(tenantScopedName('workspace', 'org-a', 'ws-1')).toBe('org:org-a/kind:workspace/ws-1');
    expect(tenantScopedName('sandbox', 'org-a', 'sb-1')).toBe('org:org-a/kind:sandbox/sb-1');
  });
});

describe('tenantScopedId', () => {
  it('rejects an empty orgId in the auth context', () => {
    const { env } = makeEnv();
    expect(() => tenantScopedId(env, 'chat', { ...baseAuth, orgId: '' }, 'sess-1')).toThrow(
      /orgId required/,
    );
    expect(() => tenantScopedId(env, 'chat', { ...baseAuth, orgId: '   ' }, 'sess-1')).toThrow(
      /orgId required/,
    );
  });

  it('rejects an empty suffix', () => {
    const { env } = makeEnv();
    expect(() => tenantScopedId(env, 'chat', baseAuth, '')).toThrow(/suffix required/);
  });

  it('hands the org-prefixed name to idFromName', () => {
    const { env, calls } = makeEnv();
    tenantScopedId(env, 'chat', baseAuth, 'sess-1');
    expect(calls).toEqual(['org:org-a/kind:chat/sess-1']);
  });

  it('produces different ids for the same suffix in different orgs', () => {
    const { env } = makeEnv();
    const idA = tenantScopedId(env, 'chat', baseAuth, 'sess-1');
    const idB = tenantScopedId(env, 'chat', { ...baseAuth, orgId: 'org-b' }, 'sess-1');
    expect(idA.toString()).not.toBe(idB.toString());
  });

  it('produces the same id for repeated calls with identical inputs', () => {
    const { env } = makeEnv();
    const idA = tenantScopedId(env, 'chat', baseAuth, 'sess-1');
    const idB = tenantScopedId(env, 'chat', baseAuth, 'sess-1');
    expect(idA.toString()).toBe(idB.toString());
  });

  it('keeps chat and workspace ids in disjoint namespaces', () => {
    const { env } = makeEnv();
    const chatId = tenantScopedId(env, 'chat', baseAuth, 'foo');
    const wsId = tenantScopedId(env, 'workspace', baseAuth, 'foo');
    expect(chatId.toString()).not.toBe(wsId.toString());
  });
});
