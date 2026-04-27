/**
 * `npx flowlib-cli init` — Initialize Invect in your project
 *
 * Interactive setup wizard that:
 *   1. Detects your framework (Express, NestJS, Next.js)
 *   2. Installs @flowlib/core + framework adapter
 *   3. Creates flowlib.config.ts
 *   4. Generates initial database schema files
 *   5. Creates a starter route handler
 *
 * Usage:
 *   npx flowlib-cli init
 *   npx flowlib-cli init --framework express
 *   npx flowlib-cli init --database sqlite
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import prompts from 'prompts';

/** Exit cleanly when the user cancels a prompt (Ctrl-C). */
const onCancel = () => {
  console.log(pc.dim('\n  Cancelled.\n'));
  process.exit(0);
};

function isDebug(): boolean {
  return process.argv.includes('--debug');
}

function debug(...args: unknown[]) {
  if (isDebug()) {
    console.log(
      pc.dim(
        `  [debug] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')}`,
      ),
    );
  }
}

function debugError(label: string, error: unknown) {
  if (isDebug()) {
    console.error(pc.yellow(`  [debug] ${label}:`));
    if (error instanceof Error) {
      console.error(pc.dim(`    ${error.message}`));
      if (error.stack) {
        console.error(
          pc.dim(
            error.stack
              .split('\n')
              .slice(1)
              .map((l) => `    ${l.trim()}`)
              .join('\n'),
          ),
        );
      }
    } else {
      console.error(pc.dim(`    ${String(error)}`));
    }
  }
}

// =============================================================================
// Constants
// =============================================================================

export const FRAMEWORKS = [
  {
    name: 'Express',
    id: 'express',
    dependency: 'express',
    adapterPackage: '@flowlib/express',
    configPaths: null,
  },
  {
    name: 'NestJS',
    id: 'nestjs',
    dependency: '@nestjs/core',
    adapterPackage: '@flowlib/nestjs',
    configPaths: ['nest-cli.json'],
  },
  {
    name: 'Next.js',
    id: 'nextjs',
    dependency: 'next',
    adapterPackage: '@flowlib/nextjs',
    configPaths: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
  },
  {
    name: 'Other / Custom',
    id: 'other',
    dependency: null,
    adapterPackage: null,
    configPaths: null,
  },
] as const;

export type Framework = (typeof FRAMEWORKS)[number];

export const DATABASES = [
  {
    name: 'SQLite',
    id: 'sqlite',
    dependency: 'better-sqlite3',
    driver: 'better-sqlite3' as const,
    description: undefined,
    alsoDetect: [] as string[],
  },
  {
    name: 'SQLite (libsql)',
    id: 'sqlite',
    dependency: '@libsql/client',
    driver: 'libsql' as const,
    description: '(serverless, edge or Turso)',
    alsoDetect: [] as string[],
  },
  {
    name: 'PostgreSQL (postgres.js)',
    id: 'postgresql',
    dependency: 'postgres',
    driver: 'postgres' as const,
    description: undefined,
    alsoDetect: [] as string[],
  },
  {
    name: 'PostgreSQL (pg)',
    id: 'postgresql',
    dependency: 'pg',
    driver: 'pg' as const,
    description: '(node-postgres)',
    alsoDetect: [] as string[],
  },
  {
    name: 'PostgreSQL (Neon)',
    id: 'postgresql',
    dependency: '@neondatabase/serverless',
    driver: 'neon-serverless' as const,
    description: '(Neon serverless)',
    alsoDetect: ['@vercel/postgres'],
  },
  {
    name: 'MySQL',
    id: 'mysql',
    dependency: 'mysql2',
    driver: 'mysql2' as const,
    description: undefined,
    alsoDetect: ['mysql'],
  },
] as const;

export type Database = (typeof DATABASES)[number];

export const SCHEMA_TOOLS = [
  { name: 'Drizzle ORM', id: 'drizzle', description: 'TypeScript ORM with type-safe schema' },
  { name: 'Prisma', id: 'prisma', description: 'Schema-first ORM' },
  {
    name: 'Raw SQL',
    id: 'sql',
    description: 'Plain SQL migration file — bring your own migration tool',
  },
] as const;

type SchemaTool = (typeof SCHEMA_TOOLS)[number];

// =============================================================================
// Command
// =============================================================================

export const initCommand = new Command('init')
  .description('Initialize Invect in your project')
  .option('--framework <framework>', 'Framework to use (express, nestjs, nextjs)')
  .option('--database <database>', 'Database to use (sqlite, postgresql, mysql)')
  .option('--package-manager <pm>', 'Package manager (npm, pnpm, yarn, bun)')
  .option('--debug', 'Show detailed error messages and stack traces')
  .action(
    async (options: {
      framework?: string;
      database?: string;
      packageManager?: string;
      debug?: boolean;
    }) => {
      // Header
      console.log(
        '\n' +
          [
            `   ${pc.bold('Invect CLI')} ${pc.dim('(v0.1.0)')}`,
            `   ${pc.gray("Let's set up Invect in your project.")}`,
          ].join('\n') +
          '\n',
      );

      // Check package.json exists
      const pkgPath = path.join(process.cwd(), 'package.json');
      if (!fs.existsSync(pkgPath)) {
        console.error(
          pc.red('✗ No package.json found in the current directory.\n') +
            pc.dim('  Please initialize a project first (e.g., npm init).\n'),
        );
        process.exit(1);
      }

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      let stepNum = 0;
      const step = (text: string) => {
        stepNum++;
        console.log(pc.white(`\n${stepNum}. ${text}`));
      };

      // 1. Detect or ask for package manager
      let pm: string;
      if (options.packageManager) {
        pm = options.packageManager;
      } else {
        const detected = detectPackageManager();
        step('Select Package Manager');
        const pmChoices = [
          { title: 'npm', value: 'npm' },
          { title: 'pnpm', value: 'pnpm' },
          { title: 'yarn', value: 'yarn' },
          { title: 'bun', value: 'bun' },
        ];
        const detectedIndex = pmChoices.findIndex((c) => c.value === detected);
        const { selectedPm } = await prompts(
          {
            type: 'select',
            name: 'selectedPm',
            message: 'Package manager',
            choices: pmChoices,
            initial: detectedIndex >= 0 ? detectedIndex : 0,
          },
          { onCancel },
        );
        pm = selectedPm;
      }
      console.log(pc.dim(`  Using: ${pm}`));

      // 2. Detect or ask for framework
      step('Select Framework');

      let framework: Framework;
      if (options.framework) {
        framework =
          FRAMEWORKS.find((f) => f.id === options.framework) || FRAMEWORKS[FRAMEWORKS.length - 1]!;
      } else {
        // Try auto-detection first
        const detected = FRAMEWORKS.find((f) => f.dependency && f.dependency in allDeps);
        if (detected) {
          console.log(pc.dim(`  Detected: ${detected.name}`));
          const { useDetected } = await prompts(
            {
              type: 'confirm',
              name: 'useDetected',
              message: `Use detected framework ${pc.cyan(detected.name)}?`,
              initial: true,
            },
            { onCancel },
          );
          framework = useDetected ? detected : await askFramework();
        } else {
          framework = await askFramework();
        }
      }

      console.log(pc.dim(`  Framework: ${framework.name}`));

      // 3. Select database
      step('Select Database');

      let database: Database;
      if (options.database) {
        // Support --database libsql, pg, neon-serverless as shorthand for driver selection
        if (
          options.database === 'libsql' ||
          options.database === 'pg' ||
          options.database === 'neon-serverless'
        ) {
          database = DATABASES.find((d) => d.driver === options.database)!;
        } else {
          database =
            DATABASES.find(
              (d) =>
                d.id === options.database &&
                d.driver !== 'libsql' &&
                d.driver !== 'pg' &&
                d.driver !== 'neon-serverless',
            ) || DATABASES[0]!;
        }
      } else {
        // Try auto-detection — check both the exact driver package and common alternatives
        const detected = DATABASES.find(
          (d) => d.dependency in allDeps || d.alsoDetect.some((alt) => alt in allDeps),
        );
        if (detected) {
          // Show which package triggered the detection
          const matchedPkg =
            detected.dependency in allDeps
              ? detected.dependency
              : (detected.alsoDetect.find((alt) => alt in allDeps) ?? detected.dependency);
          console.log(pc.dim(`  Detected: ${detected.name} (found ${matchedPkg})`));
          database = await askDatabase(framework, detected);
        } else {
          database = await askDatabase(framework);
        }
      }

      console.log(pc.dim(`  Database: ${database.name}`));

      // 3. Schema tool selection
      step('Schema Management');

      // Auto-detect existing setup
      const existingDrizzleConfig = findExistingDrizzleConfig();
      const existingPrismaSchema = findExistingPrismaSchema();

      let schemaTool: SchemaTool;
      let existingSchemaPath: string | null = null;

      if (existingDrizzleConfig) {
        console.log(pc.dim(`  Detected: Drizzle (${existingDrizzleConfig})`));
        schemaTool = SCHEMA_TOOLS.find((s) => s.id === 'drizzle')!;

        const detected = parseDrizzleConfig(existingDrizzleConfig);
        if (detected?.schemaPath) {
          existingSchemaPath = await askSchemaPath(schemaTool, [
            path.relative(process.cwd(), detected.schemaPath),
          ]);
        }
      } else if (existingPrismaSchema) {
        console.log(pc.dim(`  Detected: Prisma (${existingPrismaSchema})`));
        schemaTool = SCHEMA_TOOLS.find((s) => s.id === 'prisma')!;
        existingSchemaPath = await askSchemaPath(schemaTool, [existingPrismaSchema]);
      } else {
        schemaTool = await askSchemaTool();
      }

      console.log(pc.dim(`  Tool: ${schemaTool.name}`));

      // Ask for existing schema path if not auto-detected
      if (!existingSchemaPath && schemaTool.id !== 'sql') {
        const schemaFiles =
          schemaTool.id === 'prisma'
            ? findExistingPrismaSchemaFiles()
            : findExistingDrizzleSchemaFiles();

        if (schemaFiles.length > 0) {
          existingSchemaPath = await askSchemaPath(schemaTool, schemaFiles);
        } else {
          const { customPath } = await prompts(
            {
              type: 'text',
              name: 'customPath',
              message: `Path to existing ${schemaTool.name} schema file? (leave empty to create new)`,
              initial: '',
            },
            { onCancel },
          );

          if (customPath && customPath.trim()) {
            existingSchemaPath = path.resolve(process.cwd(), customPath.trim());
            if (!fs.existsSync(existingSchemaPath)) {
              console.log(pc.dim(`  File doesn't exist yet — will create it`));
            }
          }
        }
      }

      // 4. Install dependencies
      step('Install Dependencies');

      const depsToInstall: string[] = [];
      const devDepsToInstall: string[] = [];

      if (!('@flowlib/core' in allDeps)) {
        depsToInstall.push(getPreferredPackageSpec('@flowlib/core'));
      }

      if (!('@flowlib/cli' in allDeps)) {
        devDepsToInstall.push(getPreferredPackageSpec('@flowlib/cli'));
      }

      // @flowlib/core ships postgres, better-sqlite3, mysql2, and @libsql/client
      // as direct dependencies, so they're installed transitively.
      // Only install the driver explicitly if it's NOT a core dependency
      // (currently all supported drivers are, so this is a no-op — but future-proofs
      // against drivers being moved to peerDependencies).
      const coreShippedDrivers = [
        'postgres',
        'better-sqlite3',
        'mysql2',
        '@libsql/client',
        'pg',
        '@neondatabase/serverless',
      ];
      if (!(database.dependency in allDeps) && !coreShippedDrivers.includes(database.dependency)) {
        depsToInstall.push(database.dependency);
      }

      // Prisma packages when user chooses Prisma for schema management
      if (schemaTool.id === 'prisma') {
        if (!('prisma' in allDeps)) {
          devDepsToInstall.push('prisma');
        }
        if (!('@prisma/client' in allDeps)) {
          depsToInstall.push('@prisma/client');
        }
      }

      // Framework adapter
      if (framework.adapterPackage && !(framework.adapterPackage in allDeps)) {
        depsToInstall.push(getPreferredPackageSpec(framework.adapterPackage));
      }

      // Frontend package
      if (framework.id !== 'other') {
        if (!('@flowlib/ui' in allDeps)) {
          depsToInstall.push(getPreferredPackageSpec('@flowlib/ui'));
        }
      }

      const hasPackagesToInstall = depsToInstall.length > 0 || devDepsToInstall.length > 0;

      if (depsToInstall.length > 0) {
        console.log(pc.dim(`  Dependencies: ${depsToInstall.join(', ')}`));
      }
      if (devDepsToInstall.length > 0) {
        console.log(pc.dim(`  Dev dependencies: ${devDepsToInstall.join(', ')}`));
      }
      if (!hasPackagesToInstall) {
        console.log(pc.dim('  All required packages are already installed'));
      }

      let installSucceeded = !hasPackagesToInstall;

      if (hasPackagesToInstall) {
        const { shouldInstall } = await prompts(
          {
            type: 'confirm',
            name: 'shouldInstall',
            message: `Install packages using ${pc.bold(pm)}?`,
            initial: true,
          },
          { onCancel },
        );

        if (!shouldInstall) {
          installSucceeded = false;
        } else {
          try {
            if (depsToInstall.length > 0) {
              const installCmd = getInstallCommand(pm, depsToInstall, false);
              console.log(pc.dim(`  $ ${installCmd}`));
              execSync(installCmd, { stdio: 'inherit', cwd: process.cwd() });
            }

            if (devDepsToInstall.length > 0) {
              const devCmd = getInstallCommand(pm, devDepsToInstall, true);
              console.log(pc.dim(`  $ ${devCmd}`));
              execSync(devCmd, { stdio: 'inherit', cwd: process.cwd() });
            }

            installSucceeded = true;
          } catch (error) {
            console.error(
              pc.yellow('  ⚠ Package installation failed. You can install manually later:'),
            );
            console.log(pc.dim(`    ${getInstallCommand(pm, depsToInstall, false)}`));
            if (devDepsToInstall.length > 0) {
              console.log(pc.dim(`    ${getInstallCommand(pm, devDepsToInstall, true)}`));
            }
            debugError('Package installation error', error);
          }
        }
      }

      // 5. Create config file
      step('Create Configuration');

      const configCode = generateConfigFile(framework, database);
      const configPath = path.join(process.cwd(), 'flowlib.config.ts');

      if (fs.existsSync(configPath)) {
        console.log(
          pc.yellow(`  ⚠ ${path.relative(process.cwd(), configPath)} already exists — skipping`),
        );
      } else {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, configCode, 'utf-8');
        console.log(pc.green(`  ✓ Created ${path.relative(process.cwd(), configPath)}`));
      }

      // 6. Generate encryption key
      step('Generate Encryption Key');

      const crypto = await import('node:crypto');
      const encryptionKey = crypto.randomBytes(32).toString('base64');

      // Check for .env file
      const envPath = path.join(process.cwd(), '.env');
      const envLine = `INVECT_ENCRYPTION_KEY="${encryptionKey}"`;

      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        if (!envContent.includes('INVECT_ENCRYPTION_KEY')) {
          fs.appendFileSync(envPath, `\n${envLine}\n`);
          console.log(pc.green(`  ✓ Added INVECT_ENCRYPTION_KEY to .env`));
        } else {
          console.log(pc.dim('  ℹ INVECT_ENCRYPTION_KEY already set in .env'));
        }
      } else {
        fs.writeFileSync(envPath, `${envLine}\n`);
        console.log(pc.green(`  ✓ Created .env with INVECT_ENCRYPTION_KEY`));
      }

      // 7. Setup ORM config (Drizzle only — Prisma/SQL don't need one from us)
      if (schemaTool.id === 'drizzle' && !existingDrizzleConfig) {
        step('Setup Drizzle');

        const defaultSchemaPath = getDefaultDrizzleSchemaPath(existingSchemaPath);

        const drizzleConfigCode = generateDrizzleConfigFile(database, defaultSchemaPath);
        fs.writeFileSync(path.join(process.cwd(), 'drizzle.config.ts'), drizzleConfigCode, 'utf-8');
        console.log(pc.green(`  ✓ Created drizzle.config.ts`));
      }

      // 8. Generate database schema
      step('Generate Database Schema');

      const { shouldGenerate } = await prompts(
        {
          type: 'confirm',
          name: 'shouldGenerate',
          message:
            schemaTool.id === 'sql'
              ? 'Generate SQL migration file now?'
              : existingSchemaPath
                ? 'Append Invect tables to your existing schema now?'
                : 'Generate schema files now?',
          initial: true,
        },
        { onCancel },
      );

      debug('shouldGenerate =', shouldGenerate);

      if (shouldGenerate) {
        try {
          const { generateAction } = await import('./generate.js');
          const outputDir = './db';

          if (schemaTool.id === 'sql') {
            debug('Running SQL generate mode');
            await generateAction({
              config: configPath,
              output: '.',
              adapter: 'sql',
              dialect: database.id,
              yes: true,
            });
          } else if (schemaTool.id === 'prisma') {
            debug('Running Prisma generate mode', {
              config: configPath,
              schema: existingSchemaPath,
              dialect: database.id,
            });
            await generateAction({
              config: configPath,
              output: '',
              adapter: 'prisma',
              dialect: database.id,
              schema: existingSchemaPath || undefined,
              yes: true,
            });
          } else {
            debug('Running Drizzle generate mode', { output: outputDir, dialect: database.id });
            await generateAction({
              config: configPath,
              output: outputDir,
              adapter: 'drizzle',
              dialect: database.id,
              yes: true,
            });
          }
        } catch (error) {
          console.error(
            pc.yellow('  ⚠ Schema generation failed. You can run it manually later:') +
              '\n' +
              pc.dim(`    npx flowlib-cli generate\n`),
          );
          debugError('Schema generation error', error);
        }
      } else {
        console.log(
          pc.dim('  Skipped. Run ' + pc.cyan('npx flowlib-cli generate') + ' when ready.'),
        );
      }

      // 9. Summary
      console.log(pc.bold(pc.green('\n✓ Invect initialized successfully!\n')));

      console.log(pc.dim('  Next steps:'));
      const nextSteps: string[] = [];
      let n = 1;

      nextSteps.push(`  ${n++}. Review ${pc.cyan(path.relative(process.cwd(), configPath))}`);

      if (database.id !== 'sqlite') {
        nextSteps.push(`  ${n++}. Set ${pc.cyan('DATABASE_URL')} in your .env file`);
      }

      if (!shouldGenerate) {
        nextSteps.push(
          `  ${n++}. Run ${pc.cyan('npx flowlib-cli generate')} to create schema files`,
        );
      }

      if (!shouldGenerate || !installSucceeded) {
        if (schemaTool.id === 'drizzle') {
          nextSteps.push(`  ${n++}. Run ${pc.cyan('npx drizzle-kit push')} to apply the schema`);
        } else if (schemaTool.id === 'prisma') {
          nextSteps.push(`  ${n++}. Run ${pc.cyan('npx prisma db push')} to apply the schema`);
        } else {
          nextSteps.push(`  ${n++}. Run the generated SQL file against your database`);
        }
      }

      if (framework.id === 'express') {
        nextSteps.push(
          `  ${n++}. Mount the router: ${pc.cyan("app.use('/flowlib', createInvectRouter(config))")}`,
        );
      } else if (framework.id === 'nextjs') {
        const routeFile = 'app/api/flowlib/[...flowlib]/route.ts';
        const configRelPath = path.relative(process.cwd(), configPath);
        // Compute import path from route file to config (e.g. "../../../../flowlib.config")
        const routeImportPath = path
          .relative(path.dirname(routeFile), configRelPath)
          .replace(/\.ts$/, '');

        const routeSnippet = [
          `import { createInvectHandler } from '@flowlib/nextjs';`,
          `import { config } from '${routeImportPath}';`,
          ``,
          `const handler = createInvectHandler(config);`,
          ``,
          `export const GET = handler.GET;`,
          `export const POST = handler.POST;`,
          `export const PATCH = handler.PATCH;`,
          `export const PUT = handler.PUT;`,
          `export const DELETE = handler.DELETE;`,
        ]
          .map((l) => `  ${pc.cyan(l)}`)
          .join('\n');

        nextSteps.push(`  ${n++}. Create ${pc.cyan(routeFile)}:\n\n${routeSnippet}\n`);

        // Cron maintenance route for Vercel / serverless deployments
        const cronRouteFile = 'app/api/flowlib/cron/route.ts';
        const cronRouteSnippet = [
          `import { createInvectCronHandler } from '@flowlib/nextjs';`,
          `import { config } from '${routeImportPath}';`,
          ``,
          `export const GET = createInvectCronHandler(config);`,
        ]
          .map((l) => `  ${pc.cyan(l)}`)
          .join('\n');

        const vercelJsonSnippet = [
          `{`,
          `  "crons": [{ "path": "/api/flowlib/cron", "schedule": "* * * * *" }]`,
          `}`,
        ]
          .map((l) => `  ${pc.cyan(l)}`)
          .join('\n');

        nextSteps.push(
          `  ${n++}. Create ${pc.cyan(cronRouteFile)} for background maintenance (batch polling, cron triggers, stale-run cleanup):\n\n${cronRouteSnippet}\n\n     Then add a Vercel cron in ${pc.cyan('vercel.json')}:\n\n${vercelJsonSnippet}\n`,
        );
      } else if (framework.id === 'nestjs') {
        nextSteps.push(
          `  ${n++}. Import ${pc.cyan('InvectModule.forRoot(config)')} in your AppModule`,
        );
      }

      // Frontend UI step
      if (framework.id === 'nextjs') {
        const pageFile = 'app/flowlib/[[...slug]]/page.tsx';
        // Compute relative import path from page file to flowlib.config
        const configRelPath = path.relative(process.cwd(), configPath).replace(/\.ts$/, '');
        const pageImportPath = path
          .relative(path.dirname(pageFile), configRelPath)
          .replace(/\\/g, '/');

        const pageSnippet = [
          `'use client';`,
          ``,
          `import dynamic from 'next/dynamic';`,
          `import '@flowlib/ui/styles';`,
          `import config from '${pageImportPath}';`,
          ``,
          `const Invect = dynamic(`,
          `  () => import('@flowlib/ui').then((mod) => ({ default: mod.Invect })),`,
          `  { ssr: false },`,
          `);`,
          ``,
          `export default function InvectPage() {`,
          `  return <Invect config={config} />;`,
          `}`,
        ]
          .map((l) => `  ${pc.cyan(l)}`)
          .join('\n');

        nextSteps.push(`  ${n++}. Create ${pc.cyan(pageFile)}:\n\n${pageSnippet}\n`);
      } else if (framework.id === 'express') {
        nextSteps.push(
          `  ${n++}. Add the frontend — see ${pc.cyan('https://flowlib.dev/docs/frontend')}`,
        );
      }

      for (const s of nextSteps) {
        console.log(s);
      }

      console.log('');
    },
  );

// =============================================================================
// Prompts
// =============================================================================

async function askFramework(): Promise<Framework> {
  const { framework } = await prompts(
    {
      type: 'select',
      name: 'framework',
      message: 'Which framework are you using?',
      choices: FRAMEWORKS.map((f) => ({
        title: f.name,
        value: f.id,
      })),
    },
    { onCancel },
  );

  return FRAMEWORKS.find((f) => f.id === framework)!;
}

async function askDatabase(framework?: Framework, detected?: Database): Promise<Database> {
  // For Next.js, exclude native better-sqlite3 but keep libsql (pure JS/WASM)
  const available =
    framework?.id === 'nextjs'
      ? DATABASES.filter((d) => !(d.id === 'sqlite' && d.driver === 'better-sqlite3'))
      : [...DATABASES];

  // Pre-select the detected database if provided
  const initialIndex = detected ? available.findIndex((d) => d.driver === detected.driver) : 0;

  const { database } = await prompts(
    {
      type: 'select',
      name: 'database',
      message: 'Which database will you use?',
      choices: available.map((d) => ({
        title: 'description' in d && d.description ? `${d.name} — ${d.description}` : d.name,
        value: available.indexOf(d),
      })),
      initial: Math.max(initialIndex, 0),
    },
    { onCancel },
  );

  return available[database as number]!;
}

async function askSchemaTool(): Promise<SchemaTool> {
  const { tool } = await prompts(
    {
      type: 'select',
      name: 'tool',
      message: 'How do you want to manage your database schema?',
      choices: SCHEMA_TOOLS.map((s) => ({
        title: s.name,
        description: s.description,
        value: s.id,
      })),
    },
    { onCancel },
  );

  if (!tool) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  return SCHEMA_TOOLS.find((s) => s.id === tool)!;
}

// =============================================================================
// Generators
// =============================================================================

/** @internal — exported for testing */
export function generateConfigFile(framework: Framework, database: Database): string {
  let dbConfig: string;

  // Determine if we need an explicit `driver` field.
  // Omit it when the default for the dialect is implied (postgres, better-sqlite3, mysql2).
  const defaultDrivers: Record<string, string> = {
    sqlite: 'better-sqlite3',
    postgresql: 'postgres',
    mysql: 'mysql2',
  };
  const needsDriver = database.driver && database.driver !== defaultDrivers[database.id];

  if (database.id === 'sqlite') {
    const driverLine = needsDriver ? `\n    driver: '${database.driver}',` : '';
    dbConfig = `  database: {
    type: 'sqlite',${driverLine}
    connectionString: 'file:./dev.db',
  },`;
  } else if (database.id === 'postgresql') {
    const driverLine = needsDriver ? `\n    driver: '${database.driver}',` : '';
    dbConfig = `  database: {
    type: 'postgresql',${driverLine}
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/flowlib',
  },`;
  } else {
    dbConfig = `  database: {
    type: 'mysql',
    connectionString: process.env.DATABASE_URL || 'mysql://root@localhost:3306/flowlib',
  },`;
  }

  const adapterImport = framework.adapterPackage
    ? `// import { ... } from '${framework.adapterPackage}';\n`
    : '';

  const apiPath = framework.id === 'nextjs' ? '/api/flowlib' : '/flowlib';

  return `/**
 * Invect Configuration
 *
 * This file is read by the Invect CLI for schema generation
 * and by your application at runtime.
 *
 * Docs: https://flowlib.dev/docs
 */

import { defineConfig } from '@flowlib/core';
${adapterImport}
export const config = defineConfig({
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY,
${dbConfig}
  frontendPath: '/flowlib',
  apiPath: '${apiPath}',

  // Plugins (each has backend + frontend parts)
  // plugins: [],
});
`;
}

// =============================================================================
// Utilities
// =============================================================================

function detectPackageManager(): string {
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
  return 'npm';
}

/** @internal — exported for testing */
export function getInstallCommand(pm: string, packages: string[], isDev: boolean): string {
  const flags: Record<string, string> = {
    npm: isDev ? '--save-dev' : '',
    pnpm: isDev ? '--save-dev' : '',
    yarn: isDev ? '--dev' : '',
    bun: isDev ? '--dev' : '',
  };

  const flag = flags[pm] || '';
  const cmd = pm === 'npm' ? 'npm install' : `${pm} add`;
  return `${cmd} ${flag} ${packages.join(' ')}`.replace(/\s+/g, ' ').trim();
}

function findExistingDrizzleConfig(): string | null {
  const candidates = ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs'];
  for (const file of candidates) {
    if (fs.existsSync(path.join(process.cwd(), file))) {
      return file;
    }
  }
  return null;
}

/** @internal — exported for testing */
export function generateDrizzleConfigFile(database: Database, schemaPath: string): string {
  const dbCredentials: Record<string, string> = {
    sqlite: `  dbCredentials: {
    url: process.env.DATABASE_URL || './dev.db',
  },`,
    postgresql: `  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/flowlib',
  },`,
    mysql: `  dbCredentials: {
    url: process.env.DATABASE_URL || 'mysql://root@localhost:3306/flowlib',
  },`,
  };

  const dialectMap: Record<string, string> = {
    sqlite: 'sqlite',
    postgresql: 'postgresql',
    mysql: 'mysql',
  };

  return `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: '${schemaPath}',
  dialect: '${dialectMap[database.id]}',
${dbCredentials[database.id]}
});
`;
}

/** @internal — exported for testing */
export function getDefaultDrizzleSchemaPath(existingSchemaPath?: string | null): string {
  if (existingSchemaPath) {
    const relativePath = path.relative(process.cwd(), existingSchemaPath);
    return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  }

  return './db/schema.ts';
}

/** @internal — exported for testing */
export function getPreferredPackageSpec(packageName: string, cwd = process.cwd()): string {
  if (!packageName.startsWith('@flowlib/')) {
    return packageName;
  }

  const workspaceRoot = findWorkspaceRoot(cwd);
  if (!workspaceRoot) {
    return packageName;
  }

  return hasWorkspacePackage(workspaceRoot, packageName)
    ? `${packageName}@workspace:*`
    : packageName;
}

function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function hasWorkspacePackage(workspaceRoot: string, packageName: string): boolean {
  const packageDirs = [
    path.join(workspaceRoot, 'pkg'),
    path.join(workspaceRoot, 'pkg', 'plugins'),
    path.join(workspaceRoot, 'examples'),
    path.join(workspaceRoot, 'docs'),
  ];

  for (const packageDir of packageDirs) {
    if (!fs.existsSync(packageDir)) {
      continue;
    }

    const entries = fs.readdirSync(packageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(packageDir, entry.name, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
        if (pkg.name === packageName) {
          return true;
        }
      } catch (error) {
        debugError(`Failed to read workspace package metadata from ${packageJsonPath}`, error);
      }
    }
  }

  return false;
}

function findExistingPrismaSchema(): string | null {
  const candidates = ['prisma/schema.prisma', 'schema.prisma'];
  for (const file of candidates) {
    if (fs.existsSync(path.join(process.cwd(), file))) {
      return file;
    }
  }
  return null;
}

function findExistingPrismaSchemaFiles(): string[] {
  const candidates = ['prisma/schema.prisma', 'schema.prisma'];
  return candidates.filter((file) => fs.existsSync(path.join(process.cwd(), file)));
}

/**
 * Search common locations for existing Drizzle schema files.
 * Returns all matches (not just the first).
 */
function findExistingDrizzleSchemaFiles(): string[] {
  const candidates = [
    'db/schema.ts',
    'src/db/schema.ts',
    'src/database/schema.ts',
    'database/schema.ts',
    'lib/db/schema.ts',
    'src/lib/db/schema.ts',
  ];
  return candidates.filter((file) => fs.existsSync(path.join(process.cwd(), file)));
}

/**
 * Let the user pick from discovered schema paths or enter their own.
 */
async function askSchemaPath(
  schemaTool: SchemaTool,
  discoveredPaths: string[],
): Promise<string | null> {
  const CUSTOM_VALUE = '__custom__';
  const choices = [
    ...discoveredPaths.map((p) => ({ title: p, value: p })),
    { title: pc.dim('Enter a different path…'), value: CUSTOM_VALUE },
  ];

  // If there's only one discovered path, still let the user confirm or override
  const { selected } = await prompts(
    {
      type: 'select',
      name: 'selected',
      message: `Which ${schemaTool.name} schema file should Invect use?`,
      choices,
      initial: 0,
    },
    { onCancel },
  );

  if (selected === CUSTOM_VALUE) {
    const { customPath } = await prompts(
      {
        type: 'text',
        name: 'customPath',
        message: `Path to ${schemaTool.name} schema file:`,
        initial: '',
      },
      { onCancel },
    );

    if (!customPath || !customPath.trim()) {
      return null;
    }

    const resolved = path.resolve(process.cwd(), customPath.trim());
    if (!fs.existsSync(resolved)) {
      console.log(pc.dim(`  File doesn't exist yet — will create it`));
    }
    return resolved;
  }

  return path.resolve(process.cwd(), selected);
}

/**
 * Parse drizzle.config.ts to extract schema path and dialect via regex.
 */
/** @internal — exported for testing */
export function parseDrizzleConfig(configFile: string): {
  schemaPath: string | null;
  dialect: 'sqlite' | 'postgresql' | 'mysql' | null;
} | null {
  const configPath = path.resolve(process.cwd(), configFile);
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return null;
  }

  let schemaPath: string | null = null;
  const schemaMatch = content.match(/schema\s*:\s*['"]([^'"]+)['"]/);
  if (schemaMatch) {
    schemaPath = schemaMatch[1]!;
    if (!schemaPath.endsWith('.ts') && !schemaPath.endsWith('.js')) {
      schemaPath += '.ts';
    }
    schemaPath = path.resolve(process.cwd(), schemaPath);
  }

  let dialect: 'sqlite' | 'postgresql' | 'mysql' | null = null;
  const dialectMatch = content.match(/dialect\s*:\s*['"]([^'"]+)['"]/);
  if (dialectMatch) {
    const d = dialectMatch[1]!.toLowerCase();
    if (d === 'sqlite') {
      dialect = 'sqlite';
    } else if (d === 'postgresql' || d === 'pg' || d === 'postgres') {
      dialect = 'postgresql';
    } else if (d === 'mysql') {
      dialect = 'mysql';
    }
  }

  return { schemaPath, dialect };
}
