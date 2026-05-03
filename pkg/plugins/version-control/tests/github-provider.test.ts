import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubProvider } from '../src/backend/github-provider';

/**
 * Mock fetch for GitHub API calls.
 */
function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++] ?? { status: 500, body: { error: 'unmocked' } };
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as Response;
  });
}

describe('githubProvider', () => {
  let provider: ReturnType<typeof githubProvider>;

  beforeEach(() => {
    provider = githubProvider({
      auth: { type: 'token', token: 'ghp_test_token' },
    });
  });

  describe('security posture metadata', () => {
    it('exposes the configured auth type for health hardening checks', () => {
      expect(provider.security).toMatchObject({
        authType: 'token',
        supportsAppAuth: true,
      });
    });

    it('marks GitHub App auth distinctly from PAT auth', () => {
      const appProvider = githubProvider({
        auth: {
          type: 'app',
          appId: '123',
          privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
          installationId: 456,
        },
      });

      expect(appProvider.security?.authType).toBe('app');
    });
  });

  describe('getFileContent', () => {
    it('returns file content when found', async () => {
      const content = Buffer.from('hello world').toString('base64');
      globalThis.fetch = mockFetch([
        { status: 200, body: { content, sha: 'abc123', encoding: 'base64' } },
      ]);

      const result = await provider.getFileContent('owner/repo', 'file.ts');
      expect(result).toEqual({ content: 'hello world', sha: 'abc123' });
    });

    it('returns null for 404', async () => {
      globalThis.fetch = mockFetch([{ status: 404 }]);
      const result = await provider.getFileContent('owner/repo', 'missing.ts');
      expect(result).toBeNull();
    });
  });

  describe('createOrUpdateFile', () => {
    it('creates a file and returns commit SHA', async () => {
      globalThis.fetch = mockFetch([{ status: 201, body: { commit: { sha: 'new-sha' } } }]);

      const result = await provider.createOrUpdateFile(
        'owner/repo',
        'file.ts',
        'content',
        'commit msg',
        { branch: 'main' },
      );

      expect(result).toEqual({ commitSha: 'new-sha' });
    });
  });

  describe('createBranch', () => {
    it('creates a branch from a ref', async () => {
      globalThis.fetch = mockFetch([
        // First: resolve fromRef to SHA
        { status: 200, body: { object: { sha: 'base-sha' } } },
        // Second: create ref
        { status: 201, body: { ref: 'refs/heads/new-branch' } },
      ]);

      await expect(
        provider.createBranch('owner/repo', 'new-branch', 'main'),
      ).resolves.not.toThrow();
    });
  });

  describe('createPullRequest', () => {
    it('creates a PR and returns number + url', async () => {
      globalThis.fetch = mockFetch([
        { status: 201, body: { number: 42, html_url: 'https://github.com/owner/repo/pull/42' } },
      ]);

      const result = await provider.createPullRequest('owner/repo', {
        title: 'Test PR',
        body: 'Body',
        head: 'feature',
        base: 'main',
      });

      expect(result).toEqual({ number: 42, url: 'https://github.com/owner/repo/pull/42' });
    });
  });

  describe('getPullRequest', () => {
    it('returns merged state', async () => {
      globalThis.fetch = mockFetch([
        { status: 200, body: { state: 'closed', merged: true, merged_at: '2024-01-01T00:00:00Z' } },
      ]);

      const result = await provider.getPullRequest('owner/repo', 42);
      expect(result).toEqual({ state: 'merged', mergedAt: '2024-01-01T00:00:00Z' });
    });

    it('returns open state', async () => {
      globalThis.fetch = mockFetch([
        { status: 200, body: { state: 'open', merged: false, merged_at: null } },
      ]);

      const result = await provider.getPullRequest('owner/repo', 10);
      expect(result).toEqual({ state: 'open' });
    });
  });

  describe('verifyWebhookSignature', () => {
    it('validates correct signatures', async () => {
      const crypto = require('node:crypto');
      const secret = 'webhook-secret';
      const payload = '{"action":"opened"}';
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

      expect(await provider.verifyWebhookSignature(payload, expected, secret)).toBe(true);
    });

    it('rejects incorrect signatures', async () => {
      expect(await provider.verifyWebhookSignature('payload', 'sha256=invalid', 'secret')).toBe(
        false,
      );
    });
  });
});
