/**
 * Tests for `gatherCodeContext` — parses the single combined `exec` output
 * into environment + git-status context, and degrades gracefully when the
 * workspace isn't a git repo or the exec fails entirely.
 */
import { describe, it, expect } from 'vitest';
import { gatherCodeContext } from '../gather-context';
import type { WorkspaceHandle } from '../../workspaces/types';

/** A fake handle whose `exec` returns canned stdout (or throws). */
function fakeHandle(opts: {
  stdout?: string;
  throwOnExec?: boolean;
  rootPath?: string;
}): WorkspaceHandle {
  return {
    id: 'ws-1',
    ...(opts.rootPath ? { rootPath: opts.rootPath } : {}),
    metadata: {},
    async exec() {
      if (opts.throwOnExec) {
        throw new Error('exec failed');
      }
      return { stdout: opts.stdout ?? '', stderr: '', exitCode: 0 };
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async listFiles() {
      return [];
    },
  };
}

const GIT_OUTPUT = [
  '@@FL:CWD@@',
  '/work/repo',
  '@@FL:UNAME@@',
  'Linux x86_64',
  '@@FL:ISGIT@@',
  'true',
  '@@FL:BRANCH@@',
  'feature-x',
  '@@FL:MAIN@@',
  'main',
  '@@FL:USER@@',
  'Ada <ada@x.io>',
  '@@FL:STATUS@@',
  ' M src/a.ts',
  '?? new.ts',
  '@@FL:LOG@@',
  'abc123 feat: a',
  'def456 fix: b',
  '@@FL:END@@',
].join('\n');

describe('gatherCodeContext', () => {
  it('parses env + git status from the combined exec output', async () => {
    const ctx = await gatherCodeContext(fakeHandle({ stdout: GIT_OUTPUT }), {
      model: 'openrouter/anthropic/claude-sonnet-4.5',
      today: '2026-06-16',
    });
    expect(ctx.environment).toEqual({
      cwd: '/work/repo',
      isGitRepo: true,
      platform: 'Linux x86_64',
      today: '2026-06-16',
      model: 'openrouter/anthropic/claude-sonnet-4.5',
    });
    expect(ctx.gitStatus).toEqual({
      branch: 'feature-x',
      mainBranch: 'main',
      user: 'Ada <ada@x.io>',
      status: ' M src/a.ts\n?? new.ts',
      recentCommits: 'abc123 feat: a\ndef456 fix: b',
    });
  });

  it('omits git status for a non-git workspace', async () => {
    const out = [
      '@@FL:CWD@@',
      '/tmp/scratch',
      '@@FL:UNAME@@',
      'Linux x86_64',
      '@@FL:ISGIT@@',
      '', // git rev-parse printed nothing (not a repo)
      '@@FL:USER@@',
      ' <>',
      '@@FL:END@@',
    ].join('\n');
    const ctx = await gatherCodeContext(fakeHandle({ stdout: out }), { today: '2026-06-16' });
    expect(ctx.environment.isGitRepo).toBe(false);
    expect(ctx.environment.cwd).toBe('/tmp/scratch');
    expect(ctx.gitStatus).toBeUndefined();
  });

  it('drops an empty git user ("<>")', async () => {
    const out = [
      '@@FL:ISGIT@@',
      'true',
      '@@FL:BRANCH@@',
      'main',
      '@@FL:USER@@',
      ' <>',
      '@@FL:END@@',
    ].join('\n');
    const ctx = await gatherCodeContext(fakeHandle({ stdout: out, rootPath: '/r' }), {
      today: '2026-06-16',
    });
    expect(ctx.gitStatus?.user).toBeUndefined();
    expect(ctx.gitStatus?.branch).toBe('main');
  });

  it('falls back to a minimal environment when exec throws', async () => {
    const ctx = await gatherCodeContext(fakeHandle({ throwOnExec: true, rootPath: '/work/x' }), {
      model: 'm',
      today: '2026-06-16',
    });
    expect(ctx.environment).toEqual({ cwd: '/work/x', today: '2026-06-16', model: 'm' });
    expect(ctx.gitStatus).toBeUndefined();
  });

  it('defaults today to an ISO date when not supplied', async () => {
    const ctx = await gatherCodeContext(fakeHandle({ stdout: GIT_OUTPUT }));
    expect(ctx.environment.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
