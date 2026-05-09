/**
 * Unit tests for the auth-context resolver.
 *
 * Verifies the priority chain:
 *  1. identity.metadata.orgId
 *  2. options.staticOrgId
 *  3. literal 'default-org'
 *
 * Plus the orgScope: 'required' edge cases.
 */
import { describe, it, expect } from 'vitest';
import type { FlowlibIdentity } from '@flowlib/core';
import {
  resolveAuthContext,
  DEFAULT_ORG_ID,
} from '../resolve-auth-context';

const baseIdentity: FlowlibIdentity = {
  id: 'user-123',
  role: 'user',
  teamIds: ['team-1', 'team-2'],
};

describe('resolveAuthContext', () => {
  it('uses identity.metadata.orgId when present', () => {
    const ctx = resolveAuthContext({
      ...baseIdentity,
      metadata: { orgId: 'org-from-metadata' },
    });
    expect(ctx.orgId).toBe('org-from-metadata');
    expect(ctx.userId).toBe('user-123');
    expect(ctx.role).toBe('user');
    expect(ctx.teamIds).toEqual(['team-1', 'team-2']);
  });

  it('falls back to staticOrgId when metadata is absent', () => {
    const ctx = resolveAuthContext(baseIdentity, { staticOrgId: 'acme' });
    expect(ctx.orgId).toBe('acme');
  });

  it('falls back to default-org when neither is set', () => {
    const ctx = resolveAuthContext(baseIdentity);
    expect(ctx.orgId).toBe(DEFAULT_ORG_ID);
  });

  it('coerces numeric metadata.orgId to string', () => {
    const ctx = resolveAuthContext({
      ...baseIdentity,
      metadata: { orgId: 42 },
    });
    expect(ctx.orgId).toBe('42');
  });

  it('ignores empty-string metadata.orgId', () => {
    const ctx = resolveAuthContext(
      { ...baseIdentity, metadata: { orgId: '' } },
      { staticOrgId: 'fallback' },
    );
    expect(ctx.orgId).toBe('fallback');
  });

  it('returns anonymous context when identity is null', () => {
    const ctx = resolveAuthContext(null);
    expect(ctx.userId).toBe('anonymous');
    expect(ctx.orgId).toBe(DEFAULT_ORG_ID);
    expect(ctx.role).toBe('user');
    expect(ctx.teamIds).toEqual([]);
  });

  it('throws when identity is null and orgScope is required', () => {
    expect(() => resolveAuthContext(null, { orgScope: 'required' })).toThrow(
      /no identity present/,
    );
  });

  it('still resolves when identity is present and orgScope is required', () => {
    const ctx = resolveAuthContext(
      { ...baseIdentity, metadata: { orgId: 'org-X' } },
      { orgScope: 'required' },
    );
    expect(ctx.orgId).toBe('org-X');
  });

  it('defaults role to user when missing', () => {
    const ctx = resolveAuthContext({ id: 'user-no-role' });
    expect(ctx.role).toBe('user');
  });
});
