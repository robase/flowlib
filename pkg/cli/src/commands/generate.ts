/**
 * `npx flowlib-cli generate` — Generate Drizzle schema files
 *
 * Merges the core Flowlib schema with all plugin schemas, then generates
 * a single `flowlib.schema.ts` file for the user's selected database dialect.
 *
 * After generating schema files, optionally runs `drizzle-kit generate`
 * to create SQL migration files — mirrors how Drizzle Kit chains to
 * ORM tooling after schema generation.
 *
 * Usage:
 *   npx flowlib-cli generate                    # Auto-detect config
 *   npx flowlib-cli generate --config ./my.ts   # Explicit config path
 *   npx flowlib-cli generate --output ./db      # Custom output directory
 *   npx flowlib-cli generate --yes              # Skip confirmation
 *   npx flowlib-cli generate --dialect sqlite   # Specify dialect
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
import { generateAllDrizzleSchemas, generateAppendSchema } from '../generators/drizzle.js';
import { generatePrismaSchema } from '../generators/prisma.js';

/**
 * Auto-detect the schema adapter based on project files.
 * If a Prisma schema exists or prisma is in dependencies, use prisma.
 * Otherwise default to drizzle.
 */
function detectAdapter(): string {
  const cwd = process.cwd();

  // Check for prisma schema file
  const prismaSchemaLocations = [
    path.join(cwd, 'prisma', 'schema.prisma'),
    path.join(cwd, 'schema.prisma'),
    path.join(cwd, 'prisma', 'schema'),
  ];

  for (const loc of prismaSchemaLocations) {
    if (fs.existsSync(loc)) {
      return 'prisma';
    }
  }

  // Check for prisma in dependencies
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      if (allDeps['prisma'] || allDeps['@prisma/client']) {
        return 'prisma';
      }
    }
  } catch {
    // Ignore parse errors
  }

  return 'drizzle';
}

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

export const generateCommand = new Command('generate')
  .description('Generate Drizzle or Prisma schema files from core + plugin schemas')
  .option(
    '--config <path>',
    'Path to your Flowlib config file. Defaults to the first config found.',
  )
  .option(
    '--output <path>',
    'Output directory for generated schema files (used when --schema is not set)',
    './db',
  )
  .option(
    '--schema <path>',
    'Path to your existing Drizzle schema file. Flowlib tables will be appended to this file. ' +
      'If not provided, auto-detected from drizzle.config.ts.',
  )
  .option('--adapter <adapter>', 'Schema adapter to use: "drizzle" (default) or "prisma"')
  .option(
    '--dialect <dialect>',
    'Database dialect (sqlite, postgresql, mysql). Required when using --schema. Auto-detected from drizzle.config.ts when possible.',
  )
  .option('-y, --yes', 'Skip confirmation prompt and generate directly', false)
  .action(generateAction);

/** @internal — exported for testing */
export async function generateAction(options: {
  config?: string;
  output: string;
  schema?: string;
  adapter?: string;
  dialect?: string;
  yes?: boolean;
}) {
  console.log(pc.bold('\n🔧 Flowlib Schema Generator\n'));

  // ─── Step 0: Detect adapter ─────────────────────────────────────
  const adapter = (options.adapter || detectAdapter()).toLowerCase();
  if (adapter !== 'drizzle' && adapter !== 'prisma' && adapter !== 'sql') {
    console.error(
      pc.red(`✗ Unknown adapter "${options.adapter}".`) +
        '\n' +
        pc.dim('  Supported adapters: drizzle (default), prisma, sql\n'),
    );
    process.exit(1);
  }

  // ─── Step 1: Find and load config ───────────────────────────────
  const configPath = findConfigPath(options.config);
  if (!configPath) {
    console.error(
      pc.red('✗ Could not find Flowlib config file.') +
        '\n\n' +
        pc.dim('  Searched for: flowlib.config.ts in ./, src/, lib/, config/') +
        '\n' +
        pc.dim('  Use --config <path> to specify the config file explicitly.') +
        '\n\n' +
        pc.dim('  You can create one with: ' + pc.cyan('npx flowlib-cli init')) +
        '\n',
    );
    process.exit(1);
  }

  console.log(pc.dim(`  Config: ${path.relative(process.cwd(), configPath)}`));
  if (!options.adapter && adapter !== 'drizzle') {
    console.log(pc.dim(`  Adapter: ${adapter} (auto-detected)`));
  }

  let config;
  try {
    config = await loadConfig(configPath);
    debug('Config loaded', {
      hasPlugins: !!config.plugins,
      pluginCount: config.plugins?.length ?? 0,
      // oxlint-disable-next-line typescript/no-explicit-any -- plugin type from config loader is loose
      pluginIds: config.plugins?.map((p: any) => p.id),
    });
  } catch (error) {
    console.error(
      pc.red(`\n✗ Failed to load config.`) +
        '\n' +
        pc.dim(`  ${error instanceof Error ? error.message : String(error)}`) +
        '\n\n' +
        pc.dim('  If your config uses import aliases (e.g., @/ or ~/),') +
        '\n' +
        pc.dim('  try using relative paths instead, then run the CLI again.\n'),
    );
    process.exit(1);
  }

  // ─── Step 2: Route to adapter ────────────────────────────────────
  if (adapter === 'sql') {
    await runSqlMode(config, options);
    return;
  }

  if (adapter === 'prisma') {
    await runPrismaMode(config, options);
    return;
  }

  // ─── Step 2a: Drizzle — Determine mode (append vs separate files) ─────────
  // If --schema is given, use append mode directly.
  // Otherwise, try to auto-detect the schema path from drizzle.config.ts.
  let schemaFile = options.schema ? path.resolve(process.cwd(), options.schema) : undefined;
  let dialect = normalizeDialect(options.dialect);

  // Try to resolve dialect from flowlib.config.ts database settings
  if (!dialect && config.database?.type) {
    dialect = normalizeDialect(config.database.type);
    if (dialect) {
      debug('Dialect resolved from flowlib config:', dialect);
    }
  }

  // Auto-detect from drizzle.config.ts if --schema not explicitly provided
  if (!schemaFile) {
    const detected = detectDrizzleSchema();
    if (detected) {
      schemaFile = detected.schemaPath;
      dialect = dialect || detected.dialect;
      console.log(
        pc.dim(`  Schema: ${path.relative(process.cwd(), schemaFile)}`) +
          pc.dim(` (auto-detected from ${detected.configFile})`),
      );
    }
  } else {
    console.log(pc.dim(`  Schema: ${path.relative(process.cwd(), schemaFile)}`));
  }

  // If we have a schema file, use append mode
  const useAppendMode = !!schemaFile;

  if (useAppendMode && !dialect) {
    console.error(
      pc.red('✗ Cannot determine database dialect.') +
        '\n\n' +
        pc.dim('  When using --schema, provide --dialect (sqlite, postgresql, or mysql).') +
        '\n' +
        pc.dim('  Or ensure your drizzle.config.ts specifies a dialect.\n'),
    );
    process.exit(1);
  }

  // ─── Step 3: Generate schema ────────────────────────────────────
  if (useAppendMode) {
    await runAppendMode(config, schemaFile!, dialect!, options);
  } else {
    await runSeparateFilesMode(config, { ...options, dialect: dialect || options.dialect });
  }
}

// =============================================================================
// Prisma Mode — generate or merge Prisma schema
// =============================================================================

/**
 * Generate Prisma schema using the prisma-ast merge strategy.
 *
 * Append mode — appends Flowlib tables to the user's existing schema file:
 * - If schema.prisma exists, merges Flowlib models into it
 * - If not, creates a complete schema.prisma
 * - Detects Prisma v7+ and adjusts provider/url accordingly
 * - Supports --schema and --dialect options
 */
async function runPrismaMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: { schema?: string; dialect?: string; yes?: boolean },
) {
  const provider = normalizePrismaProvider(options.dialect) || 'postgresql';
  const schemaFile = options.schema
    ? path.resolve(process.cwd(), options.schema)
    : path.resolve(process.cwd(), 'prisma/schema.prisma');

  console.log(pc.dim(`  Adapter: ${pc.cyan('Prisma')}`));
  console.log(pc.dim(`  Provider: ${pc.white(provider)}`));
  console.log(pc.dim(`  Schema: ${path.relative(process.cwd(), schemaFile)}`));

  debug('Prisma mode', { provider, schemaFile, plugins: config.plugins?.length ?? 0 });

  let result;
  try {
    result = await generatePrismaSchema({
      plugins: config.plugins,
      file: schemaFile,
      provider,
    });
    debug('Prisma generate result', {
      fileName: result.fileName,
      hasCode: result.code !== undefined,
      overwrite: result.overwrite,
      codeLength: result.code?.length,
    });
  } catch (error) {
    console.error(pc.red(`\n✗ Prisma schema generation failed:`));
    console.error(pc.dim(`  ${error instanceof Error ? error.message : String(error)}\n`));
    debugError('Prisma schema generation', error);
    process.exit(1);
  }

  if (result.code === undefined) {
    console.log(pc.bold(pc.green('\n✓ Prisma schema is already up to date.\n')));
    return;
  }

  const rel = path.relative(process.cwd(), result.fileName);
  console.log('');
  console.log(pc.bold('  Files:'));
  if (result.overwrite) {
    console.log(pc.yellow(`    ~ ${rel}`) + pc.dim(' (will update)'));
  } else {
    console.log(pc.green(`    + ${rel}`) + pc.dim(' (will create)'));
  }

  // Confirm
  if (!options.yes) {
    console.log('');
    const response = await prompts(
      {
        type: 'confirm',
        name: 'proceed',
        message: result.overwrite ? `Update ${pc.cyan(rel)}?` : `Create ${pc.cyan(rel)}?`,
        initial: true,
      },
      { onCancel },
    );

    if (!response.proceed) {
      console.log(pc.dim('\n  Cancelled.\n'));
      return;
    }
  }

  // Write file
  const dir = path.dirname(result.fileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(result.fileName, result.code, 'utf-8');

  console.log(
    pc.bold(pc.green(`\n✓ Prisma schema ${result.overwrite ? 'updated' : 'created'}: ${rel}\n`)),
  );

  // Next steps for Prisma
  console.log(pc.dim('  Next steps:'));
  console.log(
    pc.dim('    1. Run ') + pc.cyan('npx prisma db push') + pc.dim(' to apply schema changes'),
  );
  console.log(
    pc.dim('    2. Run ') +
      pc.cyan('npx prisma generate') +
      pc.dim(' to regenerate the Prisma client'),
  );
  console.log('');
}

function normalizePrismaProvider(
  dialect: string | undefined,
): 'postgresql' | 'mysql' | 'sqlite' | undefined {
  if (!dialect) {
    return undefined;
  }
  const d = dialect.toLowerCase();
  if (d === 'sqlite') {
    return 'sqlite';
  }
  if (d === 'postgresql' || d === 'pg' || d === 'postgres') {
    return 'postgresql';
  }
  if (d === 'mysql') {
    return 'mysql';
  }
  return undefined;
}

// =============================================================================
// Append Mode — append Flowlib tables to an existing schema file
// =============================================================================

async function runAppendMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  schemaFile: string,
  dialect: 'sqlite' | 'postgresql' | 'mysql',
  options: { yes?: boolean },
) {
  let appendResult;
  try {
    appendResult = await generateAppendSchema({
      plugins: config.plugins,
      dialect,
      transforms: config.schemaTransforms,
    });
  } catch (error) {
    console.error(pc.red(`\n✗ Schema generation failed:`));
    console.error(pc.dim(`  ${error instanceof Error ? error.message : String(error)}\n`));
    process.exit(1);
  }

  const { result, stats } = appendResult;

  await printSummary(config, stats);

  // Read existing file (if any)
  const fileExists = fs.existsSync(schemaFile);
  const currentFileContent = fileExists ? fs.readFileSync(schemaFile, 'utf-8') : '';
  let existingContent = currentFileContent;

  // Strip previous Flowlib generated block if present
  const marker = '// Flowlib tables — AUTO-GENERATED by @flowlib/cli';
  const markerIndex = existingContent.indexOf(marker);
  if (markerIndex !== -1) {
    // Find the start of the section marker block (includes the === line above)
    const sectionDivider =
      '// =============================================================================';
    const dividerIndex = existingContent.lastIndexOf(sectionDivider, markerIndex);
    const stripFrom = dividerIndex !== -1 ? dividerIndex : markerIndex;
    existingContent = existingContent.substring(0, stripFrom).trimEnd();
  }

  // Merge imports: add entirely new imports, or merge missing named specifiers
  const pendingImports: string[] = [];
  let mergedContent = existingContent;

  for (const imp of result.imports) {
    const fromMatch = imp.match(/from\s+['"]([^'"]+)['"]/);
    if (!fromMatch) {
      pendingImports.push(imp);
      continue;
    }

    const modulePath = fromMatch[1];
    const isTypeImport = /^import\s+type\s/.test(imp);

    // Build regex that matches existing imports from the same module,
    // distinguishing `import type {` from `import {`.
    // Use [^}]* instead of [\s\S]*? to prevent matching across multiple imports.
    const importKeyword = isTypeImport ? 'import\\s+type\\s*' : 'import\\s*';
    const moduleImportRegex = new RegExp(
      `${importKeyword}\\{([^}]*)\\}\\s*from\\s*['"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"];?`,
      'm',
    );

    const existingModuleImport = mergedContent.match(moduleImportRegex);
    if (!existingModuleImport) {
      pendingImports.push(imp);
      continue;
    }

    // oxlint-disable-next-line security/detect-unsafe-regex -- runs on generated import strings, not user input
    const newSpecifiersMatch = imp.match(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/);
    if (!newSpecifiersMatch) {
      continue;
    }

    const existingSpecifiers = existingModuleImport[1]
      .split(',')
      .map((specifier) => specifier.trim())
      .filter(Boolean);
    const nextSpecifiers = newSpecifiersMatch[1]
      .split(',')
      .map((specifier) => specifier.trim())
      .filter(Boolean);

    const mergedSpecifiers = Array.from(new Set([...existingSpecifiers, ...nextSpecifiers]));
    const typeKeyword = isTypeImport ? 'type ' : '';
    const replacement = `import ${typeKeyword}{ ${mergedSpecifiers.join(', ')} } from '${modulePath}';`;
    mergedContent = mergedContent.replace(moduleImportRegex, replacement);
  }

  // Build the final content
  let finalContent = mergedContent;

  // Insert entirely new imports after existing imports
  if (pendingImports.length > 0) {
    // Find the last import statement position
    const importRegex = /^import\s.*$/gm;
    let lastImportEnd = 0;
    let match;
    while ((match = importRegex.exec(finalContent)) !== null) {
      lastImportEnd = match.index + match[0].length;
    }

    if (lastImportEnd > 0) {
      // Insert after the last import
      finalContent =
        finalContent.substring(0, lastImportEnd) +
        '\n' +
        pendingImports.join('\n') +
        finalContent.substring(lastImportEnd);
    } else {
      // No imports found, add at the top
      finalContent = pendingImports.join('\n') + '\n' + finalContent;
    }
  }

  // Append the generated tables
  finalContent = finalContent.trimEnd() + '\n' + result.code + '\n';

  // Check if content actually changed compared to what's on disk.
  // We only skip when the final assembled content is identical to the file on disk.
  if (currentFileContent === finalContent) {
    printSummaryAlreadyUpToDate();
    return;
  }

  // Show what will happen
  const rel = path.relative(process.cwd(), schemaFile);
  console.log('');
  console.log(pc.bold('  Files:'));
  if (fileExists) {
    if (markerIndex !== -1) {
      console.log(pc.yellow(`    ~ ${rel}`) + pc.dim(' (Flowlib tables will be regenerated)'));
    } else {
      console.log(pc.green(`    ~ ${rel}`) + pc.dim(' (Flowlib tables will be appended)'));
    }
  } else {
    console.log(pc.green(`    + ${rel}`) + pc.dim(' (will create)'));
  }

  // Confirm
  if (!options.yes) {
    console.log('');
    const response = await prompts(
      {
        type: 'confirm',
        name: 'proceed',
        message: fileExists
          ? `Append Flowlib tables to ${pc.cyan(rel)}?`
          : `Create ${pc.cyan(rel)} with Flowlib tables?`,
        initial: true,
      },
      { onCancel },
    );

    if (!response.proceed) {
      console.log(pc.dim('\n  Cancelled.\n'));
      return;
    }
  }

  // Write
  const dir = path.dirname(schemaFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(schemaFile, finalContent, 'utf-8');

  // Check if the write actually changed the file on disk.
  // This can happen when the generated output matches the existing file.
  const schemaFileChanged = currentFileContent !== finalContent;

  console.log(
    pc.bold(
      pc.green(`\n✓ Flowlib tables ${markerIndex !== -1 ? 'updated' : 'appended'} in ${rel}\n`),
    ),
  );

  // Run drizzle-kit generate+migrate — but only if the schema actually changed.
  // We use generate+migrate instead of push because drizzle-kit push has a known
  // SQLite bug where it tries to CREATE INDEX without IF NOT EXISTS, failing when
  // indexes already exist during table recreation.
  if (!schemaFileChanged) {
    console.log(
      pc.dim('  Schema file unchanged after regeneration — skipping drizzle-kit.\n') +
        pc.dim('  The database is already up to date.\n'),
    );
  } else {
    let runMigrate = true;
    if (!options.yes) {
      const response = await prompts(
        {
          type: 'confirm',
          name: 'runMigrate',
          message: `Run ${pc.cyan('drizzle-kit generate')} + ${pc.cyan('drizzle-kit migrate')} to apply schema changes?`,
          initial: true,
        },
        { onCancel },
      );
      runMigrate = response.runMigrate;
    }

    if (runMigrate) {
      await runDrizzleKitGenerate();
      await runDrizzleKitMigrate();
    } else {
      console.log(
        pc.dim('\n  Next steps:') +
          pc.dim('\n    1. Run ') +
          pc.cyan('npx drizzle-kit generate') +
          pc.dim(' to create migration files') +
          pc.dim('\n    2. Run ') +
          pc.cyan('npx drizzle-kit migrate') +
          pc.dim(' to apply them\n'),
      );
    }
  }
}

// =============================================================================
// Separate Files Mode — generate standalone schema-{dialect}.ts files
// =============================================================================

async function runSeparateFilesMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: { output: string; dialect?: string; yes?: boolean },
) {
  const dialect = normalizeDialect(options.dialect);
  if (!dialect) {
    console.error(
      pc.red('✗ Cannot determine database dialect.') +
        '\n\n' +
        pc.dim('  Provide --dialect (sqlite, postgresql, or mysql).') +
        '\n' +
        pc.dim('  Or ensure your flowlib.config.ts specifies a database type.\n'),
    );
    process.exit(1);
  }

  const outputDir = path.resolve(process.cwd(), options.output);

  let generated;
  try {
    generated = await generateAllDrizzleSchemas({
      plugins: config.plugins,
      outputDir,
      dialect,
      transforms: config.schemaTransforms,
    });
  } catch (error) {
    console.error(pc.red(`\n✗ Schema generation failed:`));
    console.error(pc.dim(`  ${error instanceof Error ? error.message : String(error)}\n`));
    process.exit(1);
  }

  const { results, stats } = generated;

  await printSummary(config, stats);

  const hasChanges = results.some((r) => r.code !== undefined);

  if (!hasChanges) {
    console.log(pc.bold(pc.green('\n✓ Schema files are already up to date.\n')));
    return;
  }

  console.log('');
  console.log(pc.bold('  Files:'));
  for (const result of results) {
    const rel = path.relative(process.cwd(), result.fileName);
    if (result.code === undefined) {
      console.log(pc.dim(`    · ${rel} (unchanged)`));
    } else if (result.overwrite) {
      console.log(pc.yellow(`    ~ ${rel}`) + pc.dim(' (will update)'));
    } else {
      console.log(pc.green(`    + ${rel}`) + pc.dim(' (will create)'));
    }
  }

  // Confirm
  if (!options.yes) {
    console.log('');
    const response = await prompts(
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Generate schema files?',
        initial: true,
      },
      { onCancel },
    );

    if (!response.proceed) {
      console.log(pc.dim('\n  Cancelled.\n'));
      return;
    }
  }

  // Write files
  let writtenCount = 0;
  for (const result of results) {
    if (result.code === undefined) {
      continue;
    }

    const dir = path.dirname(result.fileName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(result.fileName, result.code, 'utf-8');
    writtenCount++;
  }

  console.log(
    pc.bold(
      pc.green(`\n✓ Generated ${writtenCount} schema file${writtenCount !== 1 ? 's' : ''}.\n`),
    ),
  );

  // Optionally run drizzle-kit generate
  let runDrizzleKit = true;
  if (!options.yes) {
    const response = await prompts(
      {
        type: 'confirm',
        name: 'runDrizzleKit',
        message: `Run ${pc.cyan('drizzle-kit generate')} to create SQL migrations?`,
        initial: true,
      },
      { onCancel },
    );
    runDrizzleKit = response.runDrizzleKit;
  }

  if (runDrizzleKit) {
    await runDrizzleKitGenerate();
  } else {
    printNextSteps();
  }
}

// =============================================================================
// Shared Display Helpers
// =============================================================================

function printSummaryAlreadyUpToDate(): void {
  console.log(pc.bold(pc.green('\n✓ Schema is already up to date. Nothing to do.\n')));
}

async function printSummary(
  config: Awaited<ReturnType<typeof loadConfig>>,
  stats: { totalTables: number; coreTableCount: number; pluginTableCount: number },
) {
  const pluginsWithSchema = config.plugins.filter((p) => p.schema);
  const pluginsWithRequiredTablesOnly = config.plugins.filter(
    (p) =>
      !p.schema && Array.isArray(p.requiredTables) && (p.requiredTables as string[]).length > 0,
  );

  console.log(
    pc.dim(
      `  Plugins: ${pc.white(String(config.plugins.length))} loaded` +
        (pluginsWithSchema.length > 0
          ? `, ${pc.cyan(String(pluginsWithSchema.length))} with schema`
          : ''),
    ),
  );

  console.log(
    pc.dim(
      `  Tables:  ${pc.white(String(stats.totalTables))} total` +
        ` (${stats.coreTableCount} core` +
        (stats.pluginTableCount > 0 ? ` + ${pc.cyan(String(stats.pluginTableCount))} plugin` : '') +
        ')',
    ),
  );

  // Show per-plugin schema details
  if (pluginsWithSchema.length > 0) {
    let coreSchema: Record<string, unknown>;
    try {
      const db = await import('@flowlib/db');
      coreSchema = db.CORE_SCHEMA;
    } catch {
      coreSchema = {};
    }

    console.log('');
    for (const plugin of pluginsWithSchema) {
      const tableNames = Object.keys(plugin.schema!);
      const newTables = tableNames.filter((t) => !(t in coreSchema));
      const extendedTables = tableNames.filter((t) => t in coreSchema);

      console.log(pc.dim(`  Plugin ${pc.cyan(plugin.id)}:`));

      for (const t of newTables) {
        const fields = Object.keys(
          // oxlint-disable-next-line typescript/no-explicit-any -- plugin schema type is abstract Record
          ((plugin.schema![t] as any)?.fields || {}) as Record<string, unknown>,
        );
        console.log(
          pc.green(`    + ${t}`) +
            pc.dim(` (new table, ${fields.length} field${fields.length !== 1 ? 's' : ''})`),
        );
      }

      for (const t of extendedTables) {
        const fields = Object.keys(
          // oxlint-disable-next-line typescript/no-explicit-any -- plugin schema type is abstract Record
          ((plugin.schema![t] as any)?.fields || {}) as Record<string, unknown>,
        );
        console.log(
          pc.yellow(`    ~ ${t}`) +
            pc.dim(` (${fields.length} field${fields.length !== 1 ? 's' : ''} added)`),
        );
      }
    }
  }

  // Show warnings for plugins that need tables but don't provide schema
  if (pluginsWithRequiredTablesOnly.length > 0) {
    console.log('');
    console.log(
      pc.yellow('  ⚠ Some plugins require tables but do not provide schema definitions:'),
    );
    for (const plugin of pluginsWithRequiredTablesOnly) {
      const tables = (plugin.requiredTables as string[]).join(', ');
      console.log(pc.dim(`    ${pc.yellow(plugin.id)}: requires `) + pc.white(tables));
      if (plugin.setupInstructions) {
        console.log(pc.dim(`      → ${plugin.setupInstructions}`));
      }
    }
    console.log(
      pc.dim(
        "\n  These tables must be added to your schema manually (or via the plugin's own tooling).\n" +
          '  The generated schema files will NOT include them automatically.\n',
      ),
    );
  }
}

// =============================================================================
// Drizzle Config Auto-Detection
// =============================================================================

/**
 * Parse drizzle.config.ts to extract the schema path and dialect.
 * Uses simple regex parsing (no eval) to handle most common patterns.
 */
function detectDrizzleSchema(): {
  schemaPath: string;
  dialect: 'sqlite' | 'postgresql' | 'mysql' | undefined;
  configFile: string;
} | null {
  const configFile = findDrizzleConfig();
  if (!configFile) {
    return null;
  }

  const configPath = path.resolve(process.cwd(), configFile);
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return null;
  }

  // Extract schema path: schema: './db/schema.ts' or schema: "./db/schema"
  const schemaMatch = content.match(/schema\s*:\s*['"]([^'"]+)['"]/);
  if (!schemaMatch) {
    return null;
  }

  let schemaPath = schemaMatch[1];
  // Ensure .ts extension
  if (!schemaPath.endsWith('.ts') && !schemaPath.endsWith('.js')) {
    schemaPath += '.ts';
  }
  schemaPath = path.resolve(process.cwd(), schemaPath);

  // Extract dialect: dialect: 'sqlite' or driver: 'better-sqlite3'
  let dialect: 'sqlite' | 'postgresql' | 'mysql' | undefined;
  const dialectMatch = content.match(/dialect\s*:\s*['"]([^'"]+)['"]/);
  if (dialectMatch) {
    const d = dialectMatch[1].toLowerCase();
    if (d === 'sqlite') {
      dialect = 'sqlite';
    } else if (d === 'postgresql' || d === 'pg' || d === 'postgres') {
      dialect = 'postgresql';
    } else if (d === 'mysql') {
      dialect = 'mysql';
    }
  }

  return { schemaPath, dialect, configFile };
}

function normalizeDialect(
  dialect: string | undefined,
): 'sqlite' | 'postgresql' | 'mysql' | undefined {
  if (!dialect) {
    return undefined;
  }
  const d = dialect.toLowerCase();
  if (d === 'sqlite') {
    return 'sqlite';
  }
  if (d === 'postgresql' || d === 'pg' || d === 'postgres') {
    return 'postgresql';
  }
  if (d === 'mysql') {
    return 'mysql';
  }
  return undefined;
}

// =============================================================================
// Drizzle Kit Commands
// =============================================================================

/** Env for drizzle-kit subprocesses — suppresses Node.js deprecation warnings. */
function drizzleKitEnv(): NodeJS.ProcessEnv {
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
 *
 * ORM tools like drizzle-kit and prisma often present interactive
 * confirmations (data-loss warnings, migration prompts).  When the user
 * declines, the tool exits with a non-zero code but there is no actual
 * error — we should not scare the user with "make sure X is installed".
 */
function wasAbortedByUser(error: unknown): boolean {
  const e = error as {
    signal?: string;
    status?: number | null;
    stderr?: string;
    stdout?: string;
    message?: string;
  };

  // Child killed by a signal (Ctrl-C, SIGTERM, etc.)
  if (e.signal === 'SIGINT' || e.signal === 'SIGTERM') {
    return true;
  }

  // drizzle-kit exits with status 0 when the user selects "No, abort"
  // in its interactive prompts, but some versions use status 1.
  // Check combined output for common abort phrases.
  const combined = [e.stdout || '', e.stderr || '', e.message || ''].join('\n').toLowerCase();
  if (/abort|cancell?ed|user\s+reject/i.test(combined)) {
    return true;
  }

  return false;
}

async function runDrizzleKitGenerate(): Promise<void> {
  console.log(pc.dim('\n  Running drizzle-kit generate...\n'));

  try {
    const configFile = findDrizzleConfig();
    const cmd = configFile
      ? `npx drizzle-kit generate --config ${configFile}`
      : 'npx drizzle-kit generate';

    execSync(cmd, {
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: process.cwd(),
      env: drizzleKitEnv(),
      timeout: 30_000,
    });

    console.log(
      pc.bold(pc.green('\n✓ SQL migrations generated.\n')) +
        pc.dim('  Run ') +
        pc.cyan('npx flowlib-cli migrate') +
        pc.dim(' to apply them.\n'),
    );
  } catch (error: unknown) {
    if (wasAbortedByUser(error)) {
      console.log(pc.dim('\n  drizzle-kit generate was cancelled.\n'));
      return;
    }

    console.error(
      pc.yellow('\n⚠ drizzle-kit generate encountered an error (see above).') +
        '\n' +
        pc.dim('  You can retry manually: ') +
        pc.cyan('npx drizzle-kit generate') +
        '\n',
    );
  }
}

async function _runDrizzleKitPush(): Promise<void> {
  console.log(pc.dim('\n  Running drizzle-kit push...\n'));

  try {
    const configFile = findDrizzleConfig();
    const cmd = configFile ? `npx drizzle-kit push --config ${configFile}` : 'npx drizzle-kit push';

    // Use stdio: 'inherit' so drizzle-kit can display interactive prompts
    // (data-loss confirmations, etc.) and the user can respond to them.
    execSync(cmd, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: drizzleKitEnv(),
    });

    console.log(pc.bold(pc.green('\n✓ Schema pushed to database.\n')));
  } catch (error: unknown) {
    if (wasAbortedByUser(error)) {
      console.log(pc.dim('\n  drizzle-kit push was cancelled.\n'));
      return;
    }

    // The actual error was already printed to the terminal (stdio: inherit).
    console.error(
      pc.yellow('\n⚠ drizzle-kit push encountered an error (see above).') +
        '\n' +
        pc.dim('  You can retry manually: ') +
        pc.cyan('npx drizzle-kit push') +
        '\n',
    );
  }
}

async function runDrizzleKitMigrate(): Promise<void> {
  console.log(pc.dim('\n  Running drizzle-kit migrate...\n'));

  try {
    const configFile = findDrizzleConfig();
    const cmd = configFile
      ? `npx drizzle-kit migrate --config ${configFile}`
      : 'npx drizzle-kit migrate';

    execSync(cmd, {
      cwd: process.cwd(),
      stdio: ['pipe', 'inherit', 'inherit'],
      env: drizzleKitEnv(),
    });

    console.log(pc.bold(pc.green('\n✓ Migrations applied.\n')));
  } catch (error: unknown) {
    if (wasAbortedByUser(error)) {
      console.log(pc.dim('\n  drizzle-kit migrate was cancelled.\n'));
      return;
    }

    console.error(
      pc.yellow('\n⚠ drizzle-kit migrate encountered an error (see above).') +
        '\n' +
        pc.dim('  You can retry manually: ') +
        pc.cyan('npx drizzle-kit migrate') +
        '\n',
    );
  }
}

function findDrizzleConfig(): string | null {
  const candidates = [
    'drizzle.config.ts',
    'drizzle.config.js',
    'drizzle.config.sqlite.ts',
    'drizzle.config.postgres.ts',
    'drizzle.config.mysql.ts',
  ];
  for (const file of candidates) {
    if (fs.existsSync(path.resolve(process.cwd(), file))) {
      return file;
    }
  }
  return null;
}

function printNextSteps(): void {
  console.log(pc.dim('\n  Next steps:'));
  console.log(pc.dim('    1. Review the generated schema files'));
  console.log(
    pc.dim('    2. Run ') +
      pc.cyan('npx drizzle-kit generate') +
      pc.dim(' to create SQL migrations'),
  );
  console.log(
    pc.dim('    3. Run ') + pc.cyan('npx flowlib-cli migrate') + pc.dim(' to apply them'),
  );
  console.log('');
}

// =============================================================================
// SQL Mode — generate raw SQL migration file
// =============================================================================

async function runSqlMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: { output: string; dialect?: string; yes?: boolean },
) {
  const dialect = normalizeDialect(options.dialect);
  if (!dialect) {
    console.error(
      pc.red('✗ --dialect is required for the sql adapter.') +
        '\n' +
        pc.dim('  Use --dialect sqlite, --dialect postgresql, or --dialect mysql\n'),
    );
    process.exit(1);
  }

  console.log(pc.dim(`  Adapter: ${pc.cyan('Raw SQL')}`));
  console.log(pc.dim(`  Dialect: ${pc.white(dialect)}`));

  const { generateRawSql } = await import('../generators/sql.js');

  let sqlResult;
  try {
    sqlResult = await generateRawSql({
      plugins: config.plugins,
      dialect,
      outputDir: options.output || '.',
      transforms: config.schemaTransforms,
    });
  } catch (error) {
    console.error(pc.red(`\n✗ SQL generation failed:`));
    console.error(pc.dim(`  ${error instanceof Error ? error.message : String(error)}\n`));
    process.exit(1);
  }

  const { result, stats } = sqlResult;

  console.log(pc.dim(`  Plugins: ${config.plugins.length} loaded`));
  console.log(
    pc.dim(
      `  Tables:  ${stats.totalTables} total (${stats.coreTableCount} core${stats.pluginTableCount > 0 ? `, ${stats.pluginTableCount} plugin` : ''})`,
    ),
  );

  if (result.code === undefined) {
    console.log(pc.bold(pc.green('\n✓ SQL migration file is already up to date.\n')));
    return;
  }

  const rel = path.relative(process.cwd(), result.fileName);
  console.log('');
  console.log(pc.bold('  Files:'));
  if (result.overwrite) {
    console.log(pc.yellow(`    ~ ${rel}`) + pc.dim(' (will update)'));
  } else {
    console.log(pc.green(`    + ${rel}`) + pc.dim(' (will create)'));
  }

  // Confirm
  if (!options.yes) {
    console.log('');
    const response = await prompts(
      {
        type: 'confirm',
        name: 'proceed',
        message: result.overwrite ? `Update ${pc.cyan(rel)}?` : `Create ${pc.cyan(rel)}?`,
        initial: true,
      },
      { onCancel },
    );

    if (!response.proceed) {
      console.log(pc.dim('\n  Cancelled.\n'));
      return;
    }
  }

  // Write file
  const dir = path.dirname(result.fileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(result.fileName, result.code, 'utf-8');

  console.log(
    pc.bold(
      pc.green(`\n✓ SQL migration file ${result.overwrite ? 'updated' : 'created'}: ${rel}\n`),
    ),
  );

  console.log(pc.dim('  Next steps:'));
  console.log(pc.dim('    1. Review the generated SQL file'));
  console.log(pc.dim('    2. Run it against your database using your preferred tool'));
  console.log('');
}
