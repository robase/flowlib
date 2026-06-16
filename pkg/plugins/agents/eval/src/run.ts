/**
 * CLI entry — discover `*.eval.ts` case files, run them against the live
 * Anthropic provider, score, print, and exit non-zero on any failure.
 *
 * Usage (from pkg/plugins/agents):
 *   pnpm eval                       # run every case in eval/cases
 *   pnpm eval --grep clarify        # only cases whose id includes "clarify"
 *   pnpm eval --json out.json       # also write a JSON report
 *   pnpm eval --model anthropic/claude-haiku-4-5
 *
 * Requires ANTHROPIC_API_KEY in the environment, plus `ai` and
 * `@ai-sdk/anthropic` installed (optional peer deps).
 */

import { readdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runSuite } from './harness';
import { printReport, toJSON } from './report';
import { createLiveProvider, createAnthropicJudge } from './providers/ai-sdk';
import { InMemoryWorkspace } from './workspaces/memory';
import type { EvalCase, JudgeClient } from './types';

interface Args {
  grep?: string;
  json?: string;
  model?: string;
  /** Expose sandbox.* tools (needs a real workspace; off by default). */
  sandbox: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { sandbox: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grep') {
      args.grep = argv[++i];
    } else if (a === '--json') {
      args.json = argv[++i];
    } else if (a === '--model') {
      args.model = argv[++i];
    } else if (a === '--sandbox') {
      args.sandbox = true;
    }
  }
  return args;
}

/** Load every `*.eval.ts` under eval/cases as default-exported case(s). */
async function loadCases(grep?: string): Promise<EvalCase[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const casesDir = join(here, '..', 'cases');
  let entries: string[];
  try {
    entries = await readdir(casesDir);
  } catch {
    throw new Error(`No cases directory at ${casesDir}`);
  }
  const files = entries.filter((f) => f.endsWith('.eval.ts') || f.endsWith('.eval.js'));
  const cases: EvalCase[] = [];
  for (const file of files.sort()) {
    const mod = (await import(pathToFileURL(join(casesDir, file)).href)) as {
      default?: EvalCase | EvalCase[];
    };
    const exported = mod.default;
    if (!exported) {
      continue;
    }
    for (const c of Array.isArray(exported) ? exported : [exported]) {
      if (!grep || c.id.includes(grep)) {
        cases.push(c);
      }
    }
  }
  return cases;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const cases = await loadCases(args.grep);
  if (cases.length === 0) {
    // eslint-disable-next-line no-console
    console.error('No matching eval cases found.');
    process.exit(2);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line no-console
    console.error(
      'ANTHROPIC_API_KEY is not set. Live evals call the real model.\n' +
        'Set the key, or write harness self-tests with the scripted provider (pnpm eval:test).',
    );
    process.exit(2);
  }

  const provider = await createLiveProvider({
    ...(args.model ? { defaultModel: args.model } : {}),
    withSandboxTools: args.sandbox,
  });

  // Lazily build the judge only if a case needs it.
  let judgeClient: JudgeClient | undefined;
  const judge: JudgeClient = async (input) => {
    if (!judgeClient) {
      judgeClient = await createAnthropicJudge();
    }
    return judgeClient(input);
  };

  // eslint-disable-next-line no-console
  console.log(`Running ${cases.length} eval case(s)${args.model ? ` on ${args.model}` : ''}…`);

  const suite = await runSuite(cases, {
    provider,
    judge,
    ...(args.model ? { defaultModel: args.model } : {}),
    createWorkspace: () => new InMemoryWorkspace(),
    onCaseComplete: (cr) => {
      const mark = cr.error ? 'ERROR' : cr.passed ? 'pass' : 'FAIL';
      // eslint-disable-next-line no-console
      console.log(`  [${mark}] ${cr.case.id}`);
    },
  });

  printReport(suite);

  if (args.json) {
    await writeFile(args.json, JSON.stringify(toJSON(suite), null, 2));
    // eslint-disable-next-line no-console
    console.log(`Wrote JSON report to ${args.json}`);
  }

  process.exit(suite.failed + suite.errored === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
