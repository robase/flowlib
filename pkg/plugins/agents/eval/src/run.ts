/**
 * CLI entry — discover `*.eval.ts` case files, run them against the live
 * Anthropic provider, score, print, and exit non-zero on any failure.
 *
 * Usage (from pkg/plugins/agents):
 *   pnpm eval                          # every non-sandbox case in eval/cases
 *   pnpm eval --grep clarify           # only cases whose id includes "clarify"
 *   pnpm eval --json out.json          # also write a JSON report
 *   pnpm eval --model anthropic/claude-haiku-4-5
 *   pnpm eval --samples 5              # run each case 5× (overrides per-case)
 *   pnpm eval --concurrency 6          # up to 6 cases in flight
 *   pnpm eval --sandbox                # real Docker workspace + sandbox.* tools
 *   pnpm eval --sandbox --image node:24-slim
 *
 * Requires ANTHROPIC_API_KEY, plus `ai` and `@ai-sdk/anthropic` installed.
 * `--sandbox` additionally requires Docker running.
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runSuite } from './harness';
import { printReport, toJSON } from './report';
import { createLiveProvider, createAnthropicJudge } from './providers/ai-sdk';
import { InMemoryWorkspace } from './workspaces/memory';
import { EVAL_AUTH } from './fakes';
import { localDockerWorkspace } from '../../src/backend/workspaces/local-docker/provider';
import type { WorkspaceHandle } from '../../src/backend/workspaces/types';
import type { EvalCase, JudgeClient, RunOptions } from './types';

interface Args {
  grep?: string;
  json?: string;
  model?: string;
  samples?: number;
  concurrency?: number;
  sandbox: boolean;
  image: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { sandbox: false, image: 'node:24-slim' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grep') {args.grep = argv[++i];}
    else if (a === '--json') {args.json = argv[++i];}
    else if (a === '--model') {args.model = argv[++i];}
    else if (a === '--samples') {args.samples = Number(argv[++i]);}
    else if (a === '--concurrency') {args.concurrency = Number(argv[++i]);}
    else if (a === '--sandbox') {args.sandbox = true;}
    else if (a === '--image') {args.image = argv[++i];}
  }
  return args;
}

/** Load every `*.eval.ts` under eval/cases as default-exported case(s). */
async function loadCases(): Promise<EvalCase[]> {
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
    if (!exported) {continue;}
    for (const c of Array.isArray(exported) ? exported : [exported]) {
      cases.push(c);
    }
  }
  return cases;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let cases = await loadCases();
  if (args.grep) {
    cases = cases.filter((c) => c.id.includes(args.grep!));
  }
  // Skip sandbox-only cases unless --sandbox — and say so (no silent drop).
  if (!args.sandbox) {
    const sandboxOnly = cases.filter((c) => c.requiresSandbox);
    if (sandboxOnly.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Skipping ${sandboxOnly.length} sandbox-only case(s) (run with --sandbox): ` +
          sandboxOnly.map((c) => c.id).join(', '),
      );
    }
    cases = cases.filter((c) => !c.requiresSandbox);
  }
  // Global sample override.
  if (args.samples && args.samples > 1) {
    cases = cases.map((c) => ({ ...c, samples: args.samples }));
  }

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

  // Workspace wiring: real Docker for --sandbox, in-memory otherwise.
  let createWorkspace: RunOptions['createWorkspace'];
  let destroyWorkspace: RunOptions['destroyWorkspace'];
  if (args.sandbox) {
    const ws = localDockerWorkspace({ image: args.image });
    createWorkspace = () =>
      ws.create({
        workspaceId: `eval-${globalThis.crypto.randomUUID()}`,
        auth: EVAL_AUTH,
        name: 'eval',
      });
    destroyWorkspace = (handle: WorkspaceHandle) => ws.destroy(handle.id, EVAL_AUTH);
    // eslint-disable-next-line no-console
    console.log(`Sandbox mode: Docker image ${args.image}`);
  } else {
    createWorkspace = () => new InMemoryWorkspace();
  }

  // Lazily build the judge only if a case needs it.
  let judgeClient: JudgeClient | undefined;
  const judge: JudgeClient = async (input) => {
    if (!judgeClient) {judgeClient = await createAnthropicJudge();}
    return judgeClient(input);
  };

  const concurrency = args.concurrency ?? (args.sandbox ? 1 : 4);
  // eslint-disable-next-line no-console
  console.log(
    `Running ${cases.length} eval case(s)${args.model ? ` on ${args.model}` : ''} ` +
      `(concurrency ${concurrency})…`,
  );

  const suite = await runSuite(cases, {
    provider,
    judge,
    concurrency,
    createWorkspace,
    ...(destroyWorkspace ? { destroyWorkspace } : {}),
    ...(args.model ? { defaultModel: args.model } : {}),
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
