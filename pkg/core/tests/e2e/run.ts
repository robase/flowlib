import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from '@flowlib/db/sqlite';
import { createFlowlib } from '../../src/api/create-flowlib';
import type { FlowExample } from './example-types';
import { inputTemplateModelExample } from './input-template-model';
import {
  complexBranchingFlowExample,
  complexBranchingFlowMinorExample,
} from './complex-branching-flow';
import {
  comprehensiveFlowPremiumExample,
  comprehensiveFlowBasicExample,
} from './comprehensive-flow';
import { simpleAgentFlowExample } from './simple-agent-flow';
import { complexAgentFlowExample } from './complex-agent-flow';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(currentDir, '../dev.db');

// Register all examples to run
const examples: FlowExample[] = [
  // Complex branching tests (no AI required)
  complexBranchingFlowExample,
  complexBranchingFlowMinorExample,
  // AI-powered tests (requires API key)
  inputTemplateModelExample,
  // Comprehensive tests - all node types (requires API key)
  comprehensiveFlowPremiumExample,
  comprehensiveFlowBasicExample,
  // Agent tests - AI with tool use (requires API key)
  simpleAgentFlowExample,
  complexAgentFlowExample,
];

async function runExamples(): Promise<void> {
  console.log('🚀 Starting Flowlib E2E Examples\n');
  console.log('='.repeat(80));

  const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!hasApiKey) {
    console.error('❌ No AI API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
    process.exit(1);
  }

  // Initialize Flowlib
  const flowlib = await createFlowlib({
    database: {
      type: 'sqlite',
      connectionString: `file:${sqlitePath}`,
    },
    logging: {
      level: 'warn', // Use "debug" for verbose output
    },
  });

  try {
    console.log('✅ Flowlib initialized\n');

    let passed = 0;
    let failed = 0;

    for (const example of examples) {
      console.log('='.repeat(80));
      console.log(`▶️  ${example.name}`);
      console.log(`   ${example.description}`);
      console.log('-'.repeat(80));

      try {
        const result = await example.execute(flowlib);
        await Promise.resolve(example.expected(result));
        console.log(`\n✅ PASSED: ${example.name}\n`);
        passed++;
      } catch (error) {
        console.error(`\n❌ FAILED: ${example.name}`);
        if (error instanceof Error) {
          console.error(`   Error: ${error.message}`);
          if (process.env.DEBUG) {
            console.error(error.stack);
          }
        } else {
          console.error(`   Error:`, error);
        }
        console.log();
        failed++;
      }
    }

    // Summary
    console.log('='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('-'.repeat(80));
    console.log(`   Total:  ${examples.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log('='.repeat(80));

    if (failed > 0) {
      throw new Error(`${failed} example(s) failed`);
    }

    console.log('\n🎉 All E2E examples completed successfully!\n');
  } finally {
    console.log('🧹 Shutting down Flowlib...');
    try {
      await flowlib.shutdown();
      console.log('✅ Shutdown complete\n');
    } catch (error) {
      console.error('⚠️  Error during shutdown:', error);
    }
  }
}

// Run
runExamples()
  .then(() => process.exit(0))
  .catch(() => {
    console.error('\n💥 E2E run failed');
    process.exit(1);
  });
