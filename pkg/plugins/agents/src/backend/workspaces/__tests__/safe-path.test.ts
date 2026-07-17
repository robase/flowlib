/**
 * Path confinement shared by the local-docker and ComputeSDK handles.
 * Every path reaching these functions is ultimately LLM-supplied.
 */
import { describe, it, expect } from 'vitest';
import { assertRelativeWorkspacePath, resolveWorkspacePath } from '../safe-path';

describe('resolveWorkspacePath', () => {
  it('joins relative paths onto the root', () => {
    expect(resolveWorkspacePath('/workspace', 'src/index.ts')).toBe('/workspace/src/index.ts');
    expect(resolveWorkspacePath('/workspace', './src/index.ts')).toBe('/workspace/src/index.ts');
    expect(resolveWorkspacePath('/workspace', 'a//b/')).toBe('/workspace/a/b');
  });

  it('normalises the root and the empty path to the root itself', () => {
    expect(resolveWorkspacePath('/workspace/', '')).toBe('/workspace');
    expect(resolveWorkspacePath('/workspace', '.')).toBe('/workspace');
    expect(resolveWorkspacePath('/workspace', '/workspace')).toBe('/workspace');
  });

  it('rejects relative traversal out of the workspace', () => {
    for (const p of [
      '../etc/passwd',
      '../../../../etc/shadow',
      'src/../../../root/.ssh/id_rsa',
      'a/b/..',
      '..',
    ]) {
      expect(() => resolveWorkspacePath('/workspace', p), p).toThrow(/traversal/i);
    }
  });

  it('rejects absolute paths outside the root', () => {
    for (const p of ['/etc/passwd', '/root/.ssh/authorized_keys', '/proc/self/environ', '/']) {
      expect(() => resolveWorkspacePath('/workspace', p), p).toThrow(/must live under/i);
    }
  });

  it('rejects an absolute path that only prefix-matches the root', () => {
    // `/workspace-evil` starts with `/workspace` as a *string* but is a
    // different directory — the check must be segment-aware.
    expect(() => resolveWorkspacePath('/workspace', '/workspace-evil/x')).toThrow(
      /must live under/i,
    );
  });

  it('allows absolute paths inside the root', () => {
    expect(resolveWorkspacePath('/workspace', '/workspace/src/a.ts')).toBe('/workspace/src/a.ts');
  });

  it('rejects absolute paths that traverse back out of the root', () => {
    expect(() => resolveWorkspacePath('/workspace', '/workspace/../etc/passwd')).toThrow(
      /traversal/i,
    );
  });

  it('rejects null bytes', () => {
    expect(() => resolveWorkspacePath('/workspace', 'a\0/../../etc/passwd')).toThrow(/null byte/i);
    expect(() => resolveWorkspacePath('/workspace', '/workspace/x\0.ts')).toThrow(/null byte/i);
  });

  it('does not treat "..foo" or "foo.." as traversal', () => {
    expect(resolveWorkspacePath('/workspace', '..foo/bar')).toBe('/workspace/..foo/bar');
    expect(resolveWorkspacePath('/workspace', 'foo../bar')).toBe('/workspace/foo../bar');
  });
});

describe('assertRelativeWorkspacePath', () => {
  it('returns the normalised relative path', () => {
    expect(assertRelativeWorkspacePath('src/index.ts')).toBe('src/index.ts');
    expect(assertRelativeWorkspacePath('./src/index.ts')).toBe('src/index.ts');
    expect(assertRelativeWorkspacePath('a//b/')).toBe('a/b');
  });

  it('rejects traversal, absolute paths, null bytes, and empties', () => {
    expect(() => assertRelativeWorkspacePath('../../etc/passwd')).toThrow(/traversal/i);
    expect(() => assertRelativeWorkspacePath('a/../../b')).toThrow(/traversal/i);
    expect(() => assertRelativeWorkspacePath('/etc/passwd')).toThrow(/workspace-relative/i);
    expect(() => assertRelativeWorkspacePath('x\0.ts')).toThrow(/null byte/i);
    expect(() => assertRelativeWorkspacePath('')).toThrow(/empty/i);
    expect(() => assertRelativeWorkspacePath('.')).toThrow(/empty/i);
  });
});
