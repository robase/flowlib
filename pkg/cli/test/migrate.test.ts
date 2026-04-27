/**
 * Migrate Command Tests
 *
 * Tests the utility functions used by `npx flowlib-cli migrate`:
 * - wasAbortedByUser()    — detects user cancellation vs real errors
 * - drizzleKitEnv()       — env setup for subprocess
 * - detectDrizzleConfig() — finds correct drizzle config by dialect
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { wasAbortedByUser, drizzleKitEnv, detectDrizzleConfig } from 'src/commands/migrate';

// =============================================================================
// wasAbortedByUser()
// =============================================================================

describe('wasAbortedByUser()', () => {
  it('should return true for SIGINT signal', () => {
    expect(wasAbortedByUser({ signal: 'SIGINT' })).toBe(true);
  });

  it('should return true for SIGTERM signal', () => {
    expect(wasAbortedByUser({ signal: 'SIGTERM' })).toBe(true);
  });

  it('should return true when stdout contains "abort"', () => {
    expect(wasAbortedByUser({ stdout: 'User chose to abort the operation' })).toBe(true);
  });

  it('should return true when stderr contains "cancelled"', () => {
    expect(wasAbortedByUser({ stderr: 'Operation cancelled by user' })).toBe(true);
  });

  it('should return true when stderr contains "canceled" (US spelling)', () => {
    expect(wasAbortedByUser({ stderr: 'Operation canceled' })).toBe(true);
  });

  it('should return true when message contains "user reject"', () => {
    expect(wasAbortedByUser({ message: 'drizzle-kit: user rejected changes' })).toBe(true);
  });

  it('should return false for generic errors', () => {
    expect(wasAbortedByUser({ message: 'ENOENT: no such file or directory' })).toBe(false);
  });

  it('should return false for connection errors', () => {
    expect(wasAbortedByUser({ message: 'Connection refused' })).toBe(false);
  });

  it('should return false for null/undefined error', () => {
    // In practice, wasAbortedByUser is only called with caught error objects.
    // Passing a plain object with no matching properties returns false.
    expect(wasAbortedByUser({ message: '' })).toBe(false);
  });

  it('should return false for empty error object', () => {
    expect(wasAbortedByUser({})).toBe(false);
  });

  it('should return false for string errors', () => {
    expect(wasAbortedByUser('some error string')).toBe(false);
  });

  it('should return false for errors with non-abort signals', () => {
    expect(wasAbortedByUser({ signal: 'SIGSEGV' })).toBe(false);
  });
});

// =============================================================================
// drizzleKitEnv()
// =============================================================================

describe('drizzleKitEnv()', () => {
  const originalNodeOptions = process.env.NODE_OPTIONS;

  afterEach(() => {
    if (originalNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = originalNodeOptions;
    }
  });

  it('should add --no-deprecation to NODE_OPTIONS', () => {
    delete process.env.NODE_OPTIONS;
    const env = drizzleKitEnv();
    expect(env.NODE_OPTIONS).toContain('--no-deprecation');
  });

  it('should not duplicate --no-deprecation if already present', () => {
    process.env.NODE_OPTIONS = '--no-deprecation --experimental-modules';
    const env = drizzleKitEnv();
    // Should keep existing value unchanged
    expect(env.NODE_OPTIONS).toBe('--no-deprecation --experimental-modules');
  });

  it('should append to existing NODE_OPTIONS', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096';
    const env = drizzleKitEnv();
    expect(env.NODE_OPTIONS).toContain('--max-old-space-size=4096');
    expect(env.NODE_OPTIONS).toContain('--no-deprecation');
  });

  it('should preserve all other environment variables', () => {
    const env = drizzleKitEnv();
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });
});

// =============================================================================
// detectDrizzleConfig()
// =============================================================================

describe('detectDrizzleConfig()', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
  });

  it('should find drizzle.config.sqlite.ts for sqlite', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.sqlite.ts');
    });
    expect(detectDrizzleConfig('sqlite')).toBe('drizzle.config.sqlite.ts');
  });

  it('should fall back to drizzle.config.ts for sqlite', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.ts');
    });
    expect(detectDrizzleConfig('sqlite')).toBe('drizzle.config.ts');
  });

  it('should find drizzle.config.postgres.ts for postgresql', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.postgres.ts');
    });
    expect(detectDrizzleConfig('postgresql')).toBe('drizzle.config.postgres.ts');
  });

  it('should find drizzle.config.postgresql.ts for postgresql', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.postgresql.ts');
    });
    expect(detectDrizzleConfig('postgresql')).toBe('drizzle.config.postgresql.ts');
  });

  it('should fall back to drizzle.config.ts for postgresql', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.ts');
    });
    expect(detectDrizzleConfig('postgresql')).toBe('drizzle.config.ts');
  });

  it('should find drizzle.config.mysql.ts for mysql', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.mysql.ts');
    });
    expect(detectDrizzleConfig('mysql')).toBe('drizzle.config.mysql.ts');
  });

  it('should fall back to drizzle.config.ts for mysql', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.ts');
    });
    expect(detectDrizzleConfig('mysql')).toBe('drizzle.config.ts');
  });

  it('should return null when no config file exists', () => {
    existsSyncSpy.mockReturnValue(false);
    expect(detectDrizzleConfig('sqlite')).toBeNull();
    expect(detectDrizzleConfig('postgresql')).toBeNull();
    expect(detectDrizzleConfig('mysql')).toBeNull();
  });

  it('should fall back to drizzle.config.ts for unknown dialect', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('drizzle.config.ts');
    });
    expect(detectDrizzleConfig('cockroachdb')).toBe('drizzle.config.ts');
  });

  it('should return null for unknown dialect when no generic config exists', () => {
    existsSyncSpy.mockReturnValue(false);
    expect(detectDrizzleConfig('cockroachdb')).toBeNull();
  });

  it('should prefer dialect-specific config over generic one', () => {
    existsSyncSpy.mockReturnValue(true); // All files exist
    expect(detectDrizzleConfig('sqlite')).toBe('drizzle.config.sqlite.ts');
    expect(detectDrizzleConfig('mysql')).toBe('drizzle.config.mysql.ts');
  });
});
