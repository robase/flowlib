/**
 * `npx flowlib-cli info` — Display diagnostic information
 *
 * Shows system info, detected frameworks, database config,
 * installed plugins, and schema status.
 *
 * Usage:
 *   npx flowlib-cli info
 *   npx flowlib-cli info --config ./my.ts
 *   npx flowlib-cli info --json
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import pc from 'picocolors';
import { findConfigPath, loadConfig } from '../utils/config-loader.js';

export const infoCommand = new Command('info')
  .description('Display diagnostic information about your Flowlib setup')
  .option('--config <path>', 'Path to your Flowlib config file')
  .option('--json', 'Output as JSON')
  .action(async (options: { config?: string; json?: boolean }) => {
    const info: Record<string, unknown> = {};

    // System info
    info.system = {
      os: `${os.platform()} ${os.release()} (${os.arch()})`,
      cpu: os.cpus()[0]?.model || 'unknown',
      memory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
      nodeVersion: process.version,
    };

    // Package manager detection
    info.packageManager = detectPackageManager();

    // Flowlib version
    info.flowlib = {
      cliVersion: '0.1.0',
      coreVersion: await detectPackageVersion('@flowlib/core'),
    };

    // Detected frameworks
    info.frameworks = detectFrameworks();

    // Detected database tools
    info.databases = detectDatabaseTools();

    // Config
    const configPath = findConfigPath(options.config);
    if (configPath) {
      info.configPath = path.relative(process.cwd(), configPath);

      try {
        const config = await loadConfig(configPath);
        info.plugins = config.plugins.map((p) => ({
          id: p.id,
          name: p.name || p.id,
          hasSchema: !!p.schema,
          schemaTablesCount: p.schema ? Object.keys(p.schema).length : 0,
        }));

        // Redact sensitive config data
        const safeConfig = redactSensitive(config.raw);
        info.config = safeConfig;
      } catch (error) {
        info.configError = error instanceof Error ? error.message : String(error);
      }
    } else {
      info.configPath = null;
      info.configError = 'No config file found';
    }

    // Output
    if (options.json) {
      console.log(JSON.stringify(info, null, 2));
    } else {
      printInfo(info);
    }
  });

function printInfo(info: Record<string, unknown>): void {
  console.log(pc.bold('\n📋 Flowlib Info\n'));

  // System
  const sys = info.system as Record<string, string>;
  console.log(pc.bold('  System:'));
  console.log(pc.dim(`    OS:      ${sys.os}`));
  console.log(pc.dim(`    CPU:     ${sys.cpu}`));
  console.log(pc.dim(`    Memory:  ${sys.memory}`));
  console.log(pc.dim(`    Node:    ${sys.nodeVersion}`));
  console.log('');

  // Package manager
  const pm = info.packageManager as string;
  console.log(pc.bold('  Package Manager:'));
  console.log(pc.dim(`    ${pm}`));
  console.log('');

  // Flowlib
  const imp = info.flowlib as Record<string, string>;
  console.log(pc.bold('  Flowlib:'));
  console.log(pc.dim(`    CLI:   ${imp.cliVersion}`));
  console.log(pc.dim(`    Core:  ${imp.coreVersion}`));
  console.log('');

  // Frameworks
  const fw = info.frameworks as string[];
  console.log(pc.bold('  Frameworks:'));
  if (fw.length > 0) {
    for (const f of fw) {
      console.log(pc.dim(`    ✓ ${f}`));
    }
  } else {
    console.log(pc.dim('    (none detected)'));
  }
  console.log('');

  // Databases
  const db = info.databases as string[];
  console.log(pc.bold('  Database Tools:'));
  if (db.length > 0) {
    for (const d of db) {
      console.log(pc.dim(`    ✓ ${d}`));
    }
  } else {
    console.log(pc.dim('    (none detected)'));
  }
  console.log('');

  // Config
  console.log(pc.bold('  Config:'));
  if (info.configPath) {
    console.log(pc.dim(`    File: ${info.configPath}`));
  } else {
    console.log(pc.yellow(`    ⚠ ${info.configError || 'Not found'}`));
  }

  // Plugins
  const plugins = info.plugins as Array<{
    id: string;
    name: string;
    hasSchema: boolean;
    schemaTablesCount: number;
  }>;
  if (plugins && plugins.length > 0) {
    console.log('');
    console.log(pc.bold('  Plugins:'));
    for (const p of plugins) {
      const schemaInfo = p.hasSchema ? ` (${p.schemaTablesCount} table(s))` : '';
      console.log(pc.dim(`    ✓ ${p.name}${schemaInfo}`));
    }
  }

  console.log('');
}

// =============================================================================
// Detection utilities
// =============================================================================

/** @internal — exported for testing */
export function detectPackageManager(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) {
    return 'bun';
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
    return 'npm';
  }
  return 'unknown';
}

/** @internal — exported for testing */
export async function detectPackageVersion(pkg: string): Promise<string> {
  try {
    const pkgJsonPath = path.join(process.cwd(), 'node_modules', pkg, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      return pkgJson.version || 'unknown';
    }
  } catch {
    // ignore
  }
  return 'not installed';
}

/** @internal — exported for testing */
export function detectFrameworks(): string[] {
  const frameworks: string[] = [];
  const pkgPath = path.join(process.cwd(), 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return frameworks;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps['next']) {
      frameworks.push(`Next.js (${allDeps['next']})`);
    }
    if (allDeps['@nestjs/core']) {
      frameworks.push(`NestJS (${allDeps['@nestjs/core']})`);
    }
    if (allDeps['express']) {
      frameworks.push(`Express (${allDeps['express']})`);
    }
    if (allDeps['react']) {
      frameworks.push(`React (${allDeps['react']})`);
    }
    if (allDeps['vue']) {
      frameworks.push(`Vue (${allDeps['vue']})`);
    }
    if (allDeps['svelte']) {
      frameworks.push(`Svelte (${allDeps['svelte']})`);
    }
    if (allDeps['hono']) {
      frameworks.push(`Hono (${allDeps['hono']})`);
    }
    if (allDeps['fastify']) {
      frameworks.push(`Fastify (${allDeps['fastify']})`);
    }
  } catch {
    // ignore
  }

  return frameworks;
}

/** @internal — exported for testing */
export function detectDatabaseTools(): string[] {
  const tools: string[] = [];
  const pkgPath = path.join(process.cwd(), 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return tools;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps['drizzle-orm']) {
      tools.push(`Drizzle ORM (${allDeps['drizzle-orm']})`);
    }
    if (allDeps['drizzle-kit']) {
      tools.push(`Drizzle Kit (${allDeps['drizzle-kit']})`);
    }
    if (allDeps['prisma'] || allDeps['@prisma/client']) {
      tools.push('Prisma');
    }
    if (allDeps['better-sqlite3'] || allDeps['@libsql/client']) {
      tools.push('SQLite');
    }
    if (allDeps['pg'] || allDeps['postgres']) {
      tools.push('PostgreSQL');
    }
    if (allDeps['mysql2']) {
      tools.push('MySQL');
    }
  } catch {
    // ignore
  }

  return tools;
}

/** @internal — exported for testing */
export function redactSensitive(config: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'apiKey',
    'api_key',
    'secret',
    'password',
    'token',
    'connectionString',
    'databaseUrl',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'encryptionKey',
  ];

  const redacted = { ...config };

  function redactDeep(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = redactDeep(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return redactDeep(redacted);
}
