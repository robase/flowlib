/**
 * Info Command Tests
 *
 * Tests the utility functions used by `npx flowlib-cli info`:
 * - detectPackageManager()  — lock file detection
 * - detectFrameworks()      — package.json dependency scanning
 * - detectDatabaseTools()   — database package detection
 * - redactSensitive()       — API key / password redaction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectPackageManager,
  detectFrameworks,
  detectDatabaseTools,
  redactSensitive,
} from 'src/commands/info';

// =============================================================================
// detectPackageManager()
// =============================================================================

describe('detectPackageManager()', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
  });

  it('should detect pnpm when pnpm-lock.yaml exists', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('pnpm-lock.yaml');
    });
    expect(detectPackageManager()).toBe('pnpm');
  });

  it('should detect yarn when yarn.lock exists', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('yarn.lock');
    });
    expect(detectPackageManager()).toBe('yarn');
  });

  it('should detect bun when bun.lockb exists', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('bun.lockb');
    });
    expect(detectPackageManager()).toBe('bun');
  });

  it('should detect bun when bun.lock exists', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('bun.lock');
    });
    expect(detectPackageManager()).toBe('bun');
  });

  it('should detect npm when package-lock.json exists', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('package-lock.json');
    });
    expect(detectPackageManager()).toBe('npm');
  });

  it('should return "unknown" when no lock file exists', () => {
    existsSyncSpy.mockReturnValue(false);
    expect(detectPackageManager()).toBe('unknown');
  });

  it('should prefer pnpm over other lock files', () => {
    // When multiple lock files exist, pnpm is checked first
    existsSyncSpy.mockReturnValue(true);
    expect(detectPackageManager()).toBe('pnpm');
  });
});

// =============================================================================
// detectFrameworks()
// =============================================================================

describe('detectFrameworks()', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('should detect Express from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { express: '^4.18.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('Express (^4.18.0)');
  });

  it('should detect NestJS from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
    );
    const result = detectFrameworks();
    expect(result).toContain('NestJS (^10.0.0)');
  });

  it('should detect Next.js from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { next: '15.0.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('Next.js (15.0.0)');
  });

  it('should detect React from devDependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ devDependencies: { react: '^19.0.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('React (^19.0.0)');
  });

  it('should detect Vue from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { vue: '^3.4.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('Vue (^3.4.0)');
  });

  it('should detect Svelte from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { svelte: '^5.0.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('Svelte (^5.0.0)');
  });

  it('should detect Hono from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { hono: '^4.0.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('Hono (^4.0.0)');
  });

  it('should detect Fastify from dependencies', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { fastify: '^5.0.0' } }));
    const result = detectFrameworks();
    expect(result).toContain('Fastify (^5.0.0)');
  });

  it('should detect multiple frameworks simultaneously', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({
        dependencies: { next: '15.0.0', react: '^19.0.0' },
      }),
    );
    const result = detectFrameworks();
    expect(result).toHaveLength(2);
    expect(result).toContain('Next.js (15.0.0)');
    expect(result).toContain('React (^19.0.0)');
  });

  it('should return empty array when no package.json exists', () => {
    existsSyncSpy.mockReturnValue(false);
    expect(detectFrameworks()).toEqual([]);
  });

  it('should return empty array when no frameworks detected', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { lodash: '^4.17.21' } }));
    expect(detectFrameworks()).toEqual([]);
  });

  it('should handle malformed package.json gracefully', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('not valid json');
    expect(detectFrameworks()).toEqual([]);
  });
});

// =============================================================================
// detectDatabaseTools()
// =============================================================================

describe('detectDatabaseTools()', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('should detect Drizzle ORM', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { 'drizzle-orm': '^0.36.0' } }));
    const result = detectDatabaseTools();
    expect(result).toContain('Drizzle ORM (^0.36.0)');
  });

  it('should detect Drizzle Kit', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({ devDependencies: { 'drizzle-kit': '^0.30.0' } }),
    );
    const result = detectDatabaseTools();
    expect(result).toContain('Drizzle Kit (^0.30.0)');
  });

  it('should detect Prisma from prisma package', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ devDependencies: { prisma: '^6.0.0' } }));
    expect(detectDatabaseTools()).toContain('Prisma');
  });

  it('should detect Prisma from @prisma/client', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0' } }),
    );
    expect(detectDatabaseTools()).toContain('Prisma');
  });

  it('should detect SQLite from better-sqlite3', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({ dependencies: { 'better-sqlite3': '^11.0.0' } }),
    );
    expect(detectDatabaseTools()).toContain('SQLite');
  });

  it('should detect SQLite from @libsql/client', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({ dependencies: { '@libsql/client': '^0.14.0' } }),
    );
    expect(detectDatabaseTools()).toContain('SQLite');
  });

  it('should detect PostgreSQL from pg', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { pg: '^8.0.0' } }));
    expect(detectDatabaseTools()).toContain('PostgreSQL');
  });

  it('should detect PostgreSQL from postgres', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { postgres: '^3.0.0' } }));
    expect(detectDatabaseTools()).toContain('PostgreSQL');
  });

  it('should detect MySQL from mysql2', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify({ dependencies: { mysql2: '^3.0.0' } }));
    expect(detectDatabaseTools()).toContain('MySQL');
  });

  it('should detect multiple database tools simultaneously', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify({
        dependencies: { 'drizzle-orm': '^0.36.0', 'better-sqlite3': '^11.0.0' },
        devDependencies: { 'drizzle-kit': '^0.30.0' },
      }),
    );
    const result = detectDatabaseTools();
    expect(result).toContain('Drizzle ORM (^0.36.0)');
    expect(result).toContain('Drizzle Kit (^0.30.0)');
    expect(result).toContain('SQLite');
  });

  it('should return empty array when no package.json exists', () => {
    existsSyncSpy.mockReturnValue(false);
    expect(detectDatabaseTools()).toEqual([]);
  });

  it('should handle malformed package.json gracefully', () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('broken json {{{');
    expect(detectDatabaseTools()).toEqual([]);
  });
});

// =============================================================================
// redactSensitive()
// =============================================================================

describe('redactSensitive()', () => {
  it('should redact API key fields', () => {
    const config = {
      ANTHROPIC_API_KEY: 'sk-ant-xxxxx',
      OPENAI_API_KEY: 'sk-xxxxx',
    };
    const result = redactSensitive(config);
    expect(result.ANTHROPIC_API_KEY).toBe('[REDACTED]');
    expect(result.OPENAI_API_KEY).toBe('[REDACTED]');
  });

  it('should redact password fields', () => {
    const config = { password: 's3cret', adminPassword: 'hunter2' };
    const result = redactSensitive(config);
    expect(result.password).toBe('[REDACTED]');
    expect(result.adminPassword).toBe('[REDACTED]');
  });

  it('should redact secret fields', () => {
    const config = { webhookSecret: 'whsec_xyz', clientSecret: 'cs_xxx' };
    const result = redactSensitive(config);
    expect(result.webhookSecret).toBe('[REDACTED]');
    expect(result.clientSecret).toBe('[REDACTED]');
  });

  it('should redact token fields', () => {
    const config = { accessToken: 'gho_xxx', refreshToken: 'ghr_xxx' };
    const result = redactSensitive(config);
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('should redact connectionString fields', () => {
    const config = { connectionString: 'postgresql://user:pass@localhost/db' };
    const result = redactSensitive(config);
    expect(result.connectionString).toBe('[REDACTED]');
  });

  it('should redact databaseUrl fields', () => {
    const config = { databaseUrl: 'postgresql://user:pass@localhost/db' };
    const result = redactSensitive(config);
    expect(result.databaseUrl).toBe('[REDACTED]');
  });

  it('should redact encryptionKey fields', () => {
    const config = { encryptionKey: 'base64key==' };
    const result = redactSensitive(config);
    expect(result.encryptionKey).toBe('[REDACTED]');
  });

  it('should preserve non-sensitive fields', () => {
    const config = {
      name: 'My App',
      framework: 'express',
      port: 3000,
      debug: true,
    };
    const result = redactSensitive(config);
    expect(result.name).toBe('My App');
    expect(result.framework).toBe('express');
    expect(result.port).toBe(3000);
    expect(result.debug).toBe(true);
  });

  it('should redact nested sensitive fields', () => {
    const config = {
      database: {
        connectionString: 'postgresql://user:pass@localhost/db',
        type: 'postgresql',
      },
      name: 'test',
    };
    const result = redactSensitive(config) as any;
    expect(result.database.connectionString).toBe('[REDACTED]');
    expect(result.database.type).toBe('postgresql');
    expect(result.name).toBe('test');
  });

  it('should handle deeply nested sensitive fields', () => {
    const config = {
      level1: {
        level2: {
          apiKey: 'deep-secret',
          normalField: 'visible',
        },
      },
    };
    const result = redactSensitive(config) as any;
    expect(result.level1.level2.apiKey).toBe('[REDACTED]');
    expect(result.level1.level2.normalField).toBe('visible');
  });

  it('should handle empty config', () => {
    expect(redactSensitive({})).toEqual({});
  });

  it('should not modify arrays', () => {
    const config = {
      plugins: ['auth', 'rbac'],
    };
    const result = redactSensitive(config);
    expect(result.plugins).toEqual(['auth', 'rbac']);
  });

  it('should be case-insensitive for key matching', () => {
    const config = {
      API_KEY: 'should-redact',
      ApiKey: 'should-also-redact',
    };
    const result = redactSensitive(config);
    expect(result.API_KEY).toBe('[REDACTED]');
    expect(result.ApiKey).toBe('[REDACTED]');
  });
});
