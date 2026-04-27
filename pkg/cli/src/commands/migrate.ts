/**
 * `npx flowlib-cli migrate` — Apply pending database migrations
 *
 * Applies the Invect schema directly to your database. This wraps
 * Drizzle Kit's migration commands with Invect-aware configuration.
 *
 * For development, use `--push` to apply schema changes directly
 * without generating migration files (uses `drizzle-kit push`).
 *
 * Usage:
 *   npx flowlib-cli migrate                    # Apply pending SQL migrations
 *   npx flowlib-cli migrate --push             # Push schema directly (dev mode)
 *   npx flowlib-cli migrate --config ./my.ts   # Explicit config path
 *   npx flowlib-cli migrate --yes              # Skip confirmation
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import prompts from 'prompts';
import { execSync } from 'node:child_process';
import { findConfigPath, loadConfig } from '../utils/config-loader.js';

/** Exit cleanly when the user cancels a prompt (Ctrl-C). */
const onCancel = () => {
  console.log(pc.dim('\n  Cancelled.\n'));
  process.exit(0);
};

export const migrateCommand = new Command('migrate')
  .description('Apply pending database migrations via Drizzle Kit')
  .option('--config <path>', 'Path to your Invect config file')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--push', 'Push schema directly without migration files (dev mode)')
  .action(migrateAction);

/** @internal — exported for testing */
async function migrateAction(options: { config?: string; yes?: boolean; push?: boolean }) {
  console.log(pc.bold('\n🗄️  Invect Migration\n'));

  // ─── Step 1: Find and load config ───────────────────────────────
  const configPath = findConfigPath(options.config);
  if (!configPath) {
    console.error(
      pc.red('✗ Could not find Invect config file.') +
        '\n' +
        pc.dim('  Use --config <path> to specify the config file explicitly.') +
        '\n\n' +
        pc.dim('  You can create one with: ' + pc.cyan('npx flowlib-cli init')) +
        '\n',
    );
    process.exit(1);
  }

  console.log(pc.dim(`  Config: ${path.relative(process.cwd(), configPath)}`));

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    console.error(pc.red(`✗ ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  const dbType = config.database?.type;
  const dbUrl = config.database?.connectionString;

  if (!dbType) {
    console.error(
      pc.red('✗ No database.type found in your config.') +
        '\n' +
        pc.dim('  Expected: database: { type: "sqlite" | "postgresql" | "mysql", ... }') +
        '\n',
    );
    process.exit(1);
  }

  console.log(pc.dim(`  Database: ${dbType}`));
  if (dbUrl) {
    const redacted = dbUrl.replace(/:\/\/[^@]+@/, '://***@');
    console.log(pc.dim(`  Connection: ${redacted}`));
  }

  const mode = options.push ? 'push' : 'migrate';
  console.log(
    pc.dim(
      `  Mode: ${mode === 'push' ? 'push (direct schema sync)' : 'migrate (SQL migration files)'}`,
    ),
  );

  // ─── Step 2: Confirm ───────────────────────────────────────────
  if (!options.yes) {
    const message =
      mode === 'push'
        ? `Push schema directly to your ${dbType} database?`
        : `Apply pending migrations to your ${dbType} database?`;

    const response = await prompts(
      {
        type: 'confirm',
        name: 'proceed',
        message,
        initial: true,
      },
      { onCancel },
    );

    if (!response.proceed) {
      console.log(pc.dim('\n  Cancelled.\n'));
      process.exit(0);
    }
  }

  // ─── Step 3: Run drizzle-kit ────────────────────────────────────
  console.log(pc.dim(`\n  Running drizzle-kit ${mode}...\n`));

  try {
    const drizzleConfigFile = detectDrizzleConfig(dbType);
    const configFlag = drizzleConfigFile ? ` --config ${drizzleConfigFile}` : '';
    const cmd = `npx drizzle-kit ${mode}${configFlag}`;

    execSync(cmd, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: drizzleKitEnv(),
    });

    if (mode === 'push') {
      console.log(pc.bold(pc.green('\n✓ Schema pushed successfully!\n')));
    } else {
      console.log(pc.bold(pc.green('\n✓ Migrations applied successfully!\n')));
    }
  } catch (error: unknown) {
    if (wasAbortedByUser(error)) {
      console.log(pc.dim(`\n  drizzle-kit ${mode} was cancelled.\n`));
      process.exit(0);
    }

    console.error(pc.yellow(`\n⚠ drizzle-kit ${mode} encountered an error (see above).`));

    if (mode === 'migrate') {
      console.error(
        pc.dim('  Have you generated migrations? Run: ') +
          pc.cyan('npx flowlib-cli generate') +
          '\n',
      );
    } else {
      console.error(
        pc.dim('  You can retry manually: ') + pc.cyan(`npx drizzle-kit ${mode}`) + '\n',
      );
    }

    process.exit(1);
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Env for drizzle-kit subprocesses — suppresses Node.js deprecation warnings. */
/** @internal — exported for testing */
export function drizzleKitEnv(): NodeJS.ProcessEnv {
  const existing = process.env.NODE_OPTIONS || '';
  return {
    ...process.env,
    NODE_OPTIONS: existing.includes('--no-deprecation')
      ? existing
      : `${existing} --no-deprecation`.trim(),
  };
}

/**
 * Detect whether an execSync error was caused by the user aborting the
 * subprocess (Ctrl-C, SIGINT/SIGTERM) or by the tool's own interactive
 * prompt being declined (e.g. drizzle-kit "No, abort").
 */
/** @internal — exported for testing */
export function wasAbortedByUser(error: unknown): boolean {
  const e = error as {
    signal?: string;
    status?: number | null;
    stderr?: string;
    stdout?: string;
    message?: string;
  };
  if (e.signal === 'SIGINT' || e.signal === 'SIGTERM') {
    return true;
  }
  const combined = [e.stdout || '', e.stderr || '', e.message || ''].join('\n');
  if (/abort|cancell?ed|user\s+reject/i.test(combined)) {
    return true;
  }
  return false;
}

/**
 * Detect which drizzle.config file to use based on the database type.
 * Searches for dialect-specific configs first, then falls back to generic.
 */
/** @internal — exported for testing */
export function detectDrizzleConfig(dbType: string): string | null {
  const candidates: Record<string, string[]> = {
    sqlite: ['drizzle.config.sqlite.ts', 'drizzle.config.ts'],
    postgresql: ['drizzle.config.postgres.ts', 'drizzle.config.postgresql.ts', 'drizzle.config.ts'],
    mysql: ['drizzle.config.mysql.ts', 'drizzle.config.ts'],
  };

  const searchPaths = candidates[dbType] || ['drizzle.config.ts'];
  for (const filename of searchPaths) {
    if (fs.existsSync(path.resolve(process.cwd(), filename))) {
      return filename;
    }
  }

  return null;
}
