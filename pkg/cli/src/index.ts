#!/usr/bin/env node

/**
 * @flowlib/cli — CLI for managing Flowlib projects
 *
 * Commands:
 *   init      — Initialize Flowlib in your project
 *   generate  — Generate Drizzle schema files from core + plugin schemas
 *   migrate   — Apply pending database migrations via Drizzle Kit
 *   info      — Display diagnostic information about the Flowlib setup
 *   secret    — Generate a secure encryption key
 *
 * Usage:
 *   npx flowlib-cli init
 *   npx flowlib-cli generate
 *   npx flowlib-cli migrate
 *   npx flowlib-cli info
 *   npx flowlib-cli secret
 *   npx flowlib-cli mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { migrateCommand } from './commands/migrate.js';
import { infoCommand } from './commands/info.js';
import { secretCommand } from './commands/secret.js';
import { mcpCommand } from './commands/mcp.js';

import 'dotenv/config';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// Handle exit signals
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main() {
  const program = new Command('flowlib');

  program
    .description('CLI for managing Flowlib workflow engine projects')
    .version(version)
    .option('--debug', 'Show detailed error messages and stack traces');

  program
    .addCommand(generateCommand)
    .addCommand(migrateCommand)
    .addCommand(initCommand)
    .addCommand(infoCommand)
    .addCommand(secretCommand)
    .addCommand(mcpCommand)
    .action(() => program.help());

  await program.parseAsync(process.argv);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error running Flowlib CLI:', error);
    process.exit(1);
  });
