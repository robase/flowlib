/**
 * Emit a `.flow.ts` source string for a given flow definition.
 *
 * Thin wrapper around `@flowlib/sdk`'s `emitSdkSource`. We deliberately
 * skip the JSON footer — the TypeScript source is canonical, and the
 * parse path always evaluates the file via `evaluateSdkSource` (which
 * just runs the `defineFlow(...)` call and returns its result). A
 * footer would only confuse the user and risk drifting from the
 * actual source.
 */

import { emitSdkSource } from '@flowlib/sdk';
import type { DbFlowDefinition, SdkFlowDefinition } from '@flowlib/sdk';

export function emitFlowFile(flow: SdkFlowDefinition): string {
  const result = emitSdkSource(flow as unknown as DbFlowDefinition);
  return result.code;
}
