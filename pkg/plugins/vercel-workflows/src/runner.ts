import { createFlowRunner, createFetchPromptClient, InMemoryAdapter } from '@flowlib/primitives';
import type { FlowRunnerConfig, FlowRunner } from '@flowlib/primitives';

export interface VercelFlowRunnerConfig extends Omit<FlowRunnerConfig, 'submitPrompt' | 'adapter'> {
  // The workflow-patched fetch — import from 'workflow' and pass here.
  // Required: globalThis.fetch throws inside "use workflow" functions.
  fetch: typeof globalThis.fetch;

  // submitPrompt is auto-wired from config.fetch + config.resolveCredential.
  // Pass your own to override (e.g. custom retry logic or a non-standard provider).
  submitPrompt?: FlowRunnerConfig['submitPrompt'];
}

// Creates a FlowRunner configured for Vercel Workflow context.
//
// Key difference from createFlowRunner: uses the workflow-SDK fetch (not
// globalThis.fetch, which throws inside "use workflow" functions).
//
// Usage (inside a "use workflow" function):
//
//   import { fetch, sleep } from 'workflow'
//   import { createVercelFlowRunner } from '@flowlib/vercel-workflows'
//   import { myFlow } from './my-flow'
//
//   export async function myFlowWorkflow(inputs) {
//     'use workflow'
//     globalThis.fetch = fetch  // patch BEFORE any npm package uses fetch
//     const runner = createVercelFlowRunner({
//       fetch,
//       resolveCredential: async (id) => ({ apiKey: process.env[`CREDENTIAL_${id}`] }),
//     })
//     return runner.run(myFlow, inputs)
//   }
//
// NOTE: There is no VercelAdapter for per-node durability. Vercel Workflows uses
// a compile-time SWC transform ("use step" / "use workflow") that cannot be
// emulated at runtime. The entire runner.run() call executes as a single atomic
// unit inside the wrapping "use step" or "use workflow" function.
// For long flows (> 240s) or batch AI jobs, see docs/vercel-option-b.md.
export function createVercelFlowRunner(config: VercelFlowRunnerConfig): FlowRunner {
  const submitPrompt =
    config.submitPrompt ??
    (config.resolveCredential
      ? createFetchPromptClient({
          resolveCredential: config.resolveCredential,
          fetch: config.fetch,
        })
      : undefined);

  return createFlowRunner({
    ...config,
    submitPrompt,
    adapter: new InMemoryAdapter(),
  });
}
