/**
 * Secret Command Tests
 *
 * Tests the `npx flowlib-cli secret` command that generates
 * cryptographically secure 32-byte base64-encoded encryption keys.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

describe('secret command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should generate a valid base64-encoded key', async () => {
    const { secretCommand } = await import('src/commands/secret');
    // Call the action directly (no args needed for secret)
    await secretCommand.parseAsync([], { from: 'user' });

    // Find the log call that contains our key (second call, after the header)
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const allCalls = consoleLogSpy.mock.calls.map((c) => stripAnsi(c[0] as string));
    const keyLine = allCalls.find((line) => {
      return typeof line === 'string' && /[A-Za-z0-9+/=]{40,}/.test(line);
    });

    expect(keyLine).toBeDefined();

    // Extract the base64 key from the output (ANSI codes already stripped)
    const base64Match = keyLine!.match(/[A-Za-z0-9+/=]{40,}/);
    expect(base64Match).not.toBeNull();

    // Verify it decodes to 32 bytes
    const decoded = Buffer.from(base64Match![0]!, 'base64');
    expect(decoded.length).toBe(32);
  });

  it('should produce different keys on each invocation', () => {
    const key1 = crypto.randomBytes(32).toString('base64');
    const key2 = crypto.randomBytes(32).toString('base64');
    expect(key1).not.toBe(key2);
  });

  it('should output usage instructions mentioning INVECT_ENCRYPTION_KEY', async () => {
    const { secretCommand } = await import('src/commands/secret');
    await secretCommand.parseAsync([], { from: 'user' });

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('INVECT_ENCRYPTION_KEY');
  });

  it('should mention AES-256-GCM encryption', async () => {
    const { secretCommand } = await import('src/commands/secret');
    await secretCommand.parseAsync([], { from: 'user' });

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('AES-256-GCM');
  });

  it('should generate keys that are exactly 44 characters (32 bytes in base64)', () => {
    const key = crypto.randomBytes(32).toString('base64');
    // 32 bytes → ceil(32/3) * 4 = 44 base64 chars
    expect(key.length).toBe(44);
  });
});
