/**
 * `runDocker` — error classification and timeout defaults. These drive a
 * real child process (`node`/`sh` standing in for the docker binary), so
 * no daemon is required.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_DOCKER_TIMEOUT_MS, runDocker } from '../local-docker/docker';

describe('runDocker — error classification', () => {
  it('reports a maxBuffer overflow as such, not as "docker not available"', async () => {
    // Node flags a maxBuffer overflow with a *string* `code`
    // (ERR_CHILD_PROCESS_STDIO_MAXBUFFER) exactly like a spawn ENOENT, so
    // the old `typeof code === 'string'` check blamed a missing Docker
    // install for what is really a chatty command.
    const promise = runDocker('node', ['-e', 'process.stdout.write("x".repeat(100000))'], {
      maxBuffer: 1024,
    });
    await expect(promise).rejects.toThrow(/exceeded the 1024-byte buffer/);
    await expect(promise).rejects.not.toThrow(/not available/);
  });

  it('still reports a missing binary as "docker not available"', async () => {
    await expect(runDocker('definitely-not-a-real-docker-binary', ['ps'])).rejects.toThrow(
      /docker not available \(ENOENT\)/,
    );
  });

  it('resolves a non-zero exit rather than rejecting', async () => {
    const res = await runDocker('node', ['-e', 'process.stderr.write("boom");process.exit(3)']);
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toBe('boom');
  });

  it('resolves exit 124 on timeout', async () => {
    const res = await runDocker('node', ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 250 });
    expect(res.exitCode).toBe(124);
  });

  it('passes stdin through', async () => {
    const res = await runDocker(
      'node',
      ['-e', 'process.stdin.pipe(process.stdout)'],
      { input: 'hello' },
    );
    expect(res.stdout).toBe('hello');
    expect(res.exitCode).toBe(0);
  });
});

describe('runDocker — timeout default', () => {
  it('defaults to a bounded timeout rather than 0 (unbounded)', () => {
    expect(DEFAULT_DOCKER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('allows opting out explicitly with timeoutMs: 0', async () => {
    const res = await runDocker('node', ['-e', 'process.stdout.write("ok")'], { timeoutMs: 0 });
    expect(res.stdout).toBe('ok');
  });
});
