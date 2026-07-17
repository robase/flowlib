/**
 * `runDocker` — error classification and timeout defaults.
 *
 * `node:child_process` is mocked rather than driven for real: this suite
 * runs in the Workers runtime (see `vitest.config.ts`), where spawning a
 * process segfaults the isolate. Mocking also lets us reproduce Node's
 * exact error shapes — notably the maxBuffer overflow, whose *string*
 * `code` is the whole point of the classification being tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { DEFAULT_DOCKER_TIMEOUT_MS, runDocker } from '../local-docker/docker';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

/** Fake child with a captured stdin, matching what `execFile` returns. */
function fakeChild() {
  return { stdin: { end: vi.fn() } };
}

/**
 * Script the next `execFile` call to invoke its callback with `error`,
 * `stdout`, `stderr`. Returns the fake child so stdin can be asserted.
 */
function scriptExecFile(error: unknown, stdout = '', stderr = '') {
  const child = fakeChild();
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(error, stdout, stderr);
      return child;
    },
  );
  return child;
}

/**
 * Node's error object for a given `code`. The shapes here are the ones
 * real `execFile` produces (verified against Node 20):
 *
 *   ENOENT   → code 'ENOENT',                            killed undefined
 *   maxBuffer→ code 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed undefined
 *   exit 3   → code 3,                                   killed false
 *   timeout  → code null, signal 'SIGTERM',              killed true
 *
 * Note the timeout carries a *null* code, not a string — which is why the
 * "binary missing" branch can safely test `typeof code === 'string'`.
 */
function nodeError(code: string | number | null, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`fail: ${code}`), { code, ...extra });
}

/** The options object handed to `execFile`. */
function execOptions(): { timeout?: number; maxBuffer?: number } {
  return mockExecFile.mock.calls[0][2];
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('runDocker — error classification', () => {
  it('reports a maxBuffer overflow as such, not as "docker not available"', async () => {
    // Node flags a maxBuffer overflow with a *string* code, exactly like a
    // spawn ENOENT — so the old `typeof code === 'string'` check blamed a
    // missing Docker install for what is really a chatty command.
    scriptExecFile(nodeError('ERR_CHILD_PROCESS_STDIO_MAXBUFFER'), 'x'.repeat(100), '');

    const promise = runDocker('docker', ['exec', 'c', 'cat', 'big.log'], { maxBuffer: 1024 });
    await expect(promise).rejects.toThrow(/exceeded the 1024-byte buffer/);
    await expect(promise).rejects.not.toThrow(/not available/);
  });

  it('still reports a missing binary as "docker not available"', async () => {
    scriptExecFile(nodeError('ENOENT'));
    await expect(runDocker('docker', ['ps'])).rejects.toThrow(/docker not available \(ENOENT\)/);
  });

  it('reports other spawn failures as "docker not available"', async () => {
    scriptExecFile(nodeError('EACCES'));
    await expect(runDocker('docker', ['ps'])).rejects.toThrow(/docker not available \(EACCES\)/);
  });

  it('resolves a non-zero exit rather than rejecting', async () => {
    scriptExecFile(nodeError(3), 'out', 'boom');
    const res = await runDocker('docker', ['exec', 'c', 'false']);
    expect(res).toEqual({ stdout: 'out', stderr: 'boom', exitCode: 3 });
  });

  it('resolves exit 124 when the process was killed on timeout', async () => {
    scriptExecFile(nodeError(null, { killed: true, signal: 'SIGTERM' }), '', '');
    const res = await runDocker('docker', ['exec', 'c', 'sleep', '999'], { timeoutMs: 250 });
    expect(res.exitCode).toBe(124);
  });

  it('resolves exit 0 on success', async () => {
    scriptExecFile(null, 'hello', '');
    expect(await runDocker('docker', ['ps'])).toEqual({
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
    });
  });

  it('pipes input to stdin', async () => {
    const child = scriptExecFile(null, '', '');
    await runDocker('docker', ['exec', '-i', 'c', 'cat'], { input: 'file body' });
    expect(child.stdin.end).toHaveBeenCalledWith('file body');
  });
});

describe('runDocker — timeout default', () => {
  it('applies a bounded default instead of 0 (unbounded)', async () => {
    scriptExecFile(null);
    await runDocker('docker', ['ps']);

    expect(DEFAULT_DOCKER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(execOptions().timeout).toBe(DEFAULT_DOCKER_TIMEOUT_MS);
  });

  it('honours an explicit timeout', async () => {
    scriptExecFile(null);
    await runDocker('docker', ['ps'], { timeoutMs: 5_000 });
    expect(execOptions().timeout).toBe(5_000);
  });

  it('allows opting out explicitly with timeoutMs: 0', async () => {
    scriptExecFile(null);
    await runDocker('docker', ['ps'], { timeoutMs: 0 });
    expect(execOptions().timeout).toBe(0);
  });

  it('defaults maxBuffer to 16 MiB', async () => {
    scriptExecFile(null);
    await runDocker('docker', ['ps']);
    expect(execOptions().maxBuffer).toBe(16 * 1024 * 1024);
  });
});
