/**
 * Browser-safe fragment parser — evaluates authored SDK text via `new Function`
 * with the SDK helpers injected into scope. Complements the Node-only
 * `@flowlib/sdk/evaluator` subpath for contexts that can't run jiti:
 *
 *   - The flow editor's clipboard paste (copy-paste in the browser).
 *   - Light server-side round-trip checks where the full module-eval overhead
 *     is unwanted.
 *
 * Accepts two input shapes:
 *
 *   1. Fragment-structured — `nodes: [...], edges: [...]` (the shape
 *      `serializeToSDK`'s copy-paste output produces without the full-file
 *      wrapper).
 *   2. Full file — `import ... from '...'; export default defineFlow({...})`
 *      gets unwrapped to the body, with `defineFlow` stubbed as identity
 *      during evaluation.
 *
 * Returns `{ nodes, edges }` in `@flowlib/sdk` shape — `SdkFlowNode` with
 * optional `id`/`label`/`position`, plus edges in the canonical
 * `{ from, to, handle? }` form.
 *
 * This is user-initiated evaluation (clipboard paste or test context), so the
 * `new Function` approach is acceptable — the user is the trust boundary.
 * Anything server-initiated (chat, sync-pull) should use the Node-only
 * `evaluateSdkSource` with import-scan enforcement.
 */

import { output, code, javascript, ifElse, switchNode, model, agent } from './nodes/core';
import { template } from './nodes/template';
import { httpRequest } from './nodes/http';
import { trigger } from './nodes/trigger';
import { node } from './nodes/generic';
import { tool } from './tool';
import type { SdkFlowNode, SdkEdge } from './types';

export interface ParsedFragment {
  nodes: SdkFlowNode[];
  edges: SdkEdge[];
}

/**
 * Helper names injected into the fragment evaluation scope. Matches the
 * public `@flowlib/sdk` surface one-to-one.
 */
const SDK_HELPERS: Record<string, unknown> = {
  output,
  code,
  javascript,
  ifElse,
  switchNode,
  model,
  agent,
  template,
  httpRequest,
  trigger,
  node,
  tool,
  // defineFlow is an identity passthrough here — the parser wants the raw
  // { nodes, edges } fragment, not the normalised DefinedFlow.
  defineFlow: (def: unknown) => def,
};

const HELPER_NAMES = Object.keys(SDK_HELPERS);
const HELPER_VALUES = HELPER_NAMES.map((k) => SDK_HELPERS[k]);

// ═══════════════════════════════════════════════════════════════════════════
// Shape detection
// ═══════════════════════════════════════════════════════════════════════════

function isSdkFlowNode(item: unknown): item is SdkFlowNode {
  return (
    typeof item === 'object' &&
    item !== null &&
    !Array.isArray(item) &&
    typeof (item as Record<string, unknown>).type === 'string' &&
    typeof (item as Record<string, unknown>).referenceId === 'string'
  );
}

function isSdkEdge(item: unknown): item is SdkEdge {
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    return (
      typeof obj.from === 'string' &&
      typeof obj.to === 'string' &&
      (obj.handle === undefined || typeof obj.handle === 'string')
    );
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Source pre-processing
// ═══════════════════════════════════════════════════════════════════════════

/** Strip `//` single-line and block comments from the source. */
function stripComments(text: string): string {
  // `[^\n]*` instead of `.*$/m`: behaviour-identical (`.` already excludes
  // newlines) but linear — sidesteps the polynomial-ReDoS heuristic.
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * If the input is a full `.flow.ts` file, unwrap it down to the body of the
 * `defineFlow({...})` call so `new Function` can see an object literal.
 * Strips `import` statements and unwraps `export default defineFlow({...})`
 * plus `export const name = defineFlow({...})` variants. Returns the text
 * unchanged when no wrapper is detected.
 */
function unwrapFullFile(text: string): string {
  const out = text.replace(/^\s*import[^;]*;/gm, '');

  let body = out.trim();

  // `export default defineFlow({...})` or `export default defineFlow({...});`
  if (body.startsWith('export default ')) {
    body = body.slice('export default '.length).trimStart();
  } else {
    // `export const name = defineFlow({...})` — unwrap to the defineFlow call.
    const namedExport = body.match(/^export\s+const\s+\w+\s*=\s*(defineFlow\s*\([\s\S]*)$/);
    if (namedExport) {
      body = namedExport[1].trimStart();
    }
  }

  if (!body.startsWith('defineFlow')) {
    return out;
  }
  body = body.slice('defineFlow'.length).trimStart();
  if (!body.startsWith('(')) {
    return out;
  }
  body = body.slice(1).trim();
  if (body.endsWith(';')) {
    body = body.slice(0, -1).trimEnd();
  }
  if (body.endsWith(')')) {
    body = body.slice(0, -1).trimEnd();
  }
  if (body.startsWith('{') && body.endsWith('}')) {
    return body.slice(1, -1);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse SDK source text into node definitions + edges.
 *
 * The parser is permissive: accepts the structured `nodes: [...], edges: [...]`
 * fragment form, the flat bare-call form, or a full file that will be
 * unwrapped. Missing edges are returned as an empty array.
 *
 * Throws `Error` if the text is syntactically broken — callers that want to
 * surface this to users should wrap the call.
 */
export function parseSDKText(text: string): ParsedFragment {
  let cleaned = unwrapFullFile(stripComments(text)).trim();
  if (!cleaned) {
    return { nodes: [], edges: [] };
  }

  // Strip TypeScript-only `as const` / `as <type>` annotations — the browser
  // parser is plain JavaScript and can't tolerate them. The emitter writes
  // `[{...}] as const` on trigger.manual inputs to feed the SDK helper's
  // generic at compile time; for runtime parsing we just need the literal.
  cleaned = cleaned.replace(/\)\s+as\s+const\b/g, ')');
  cleaned = cleaned.replace(/\]\s+as\s+const\b/g, ']');
  cleaned = cleaned.replace(/\}\s+as\s+const\b/g, '}');

  // Wrap the body in an object literal so `nodes:` and `edges:` become keys.
  const wrapped = `"use strict"; return ({\n${cleaned}\n})`;

  let result: unknown;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...HELPER_NAMES, wrapped);
    result = fn(...HELPER_VALUES);
  } catch (err) {
    throw new Error(
      `Failed to parse SDK text: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof result !== 'object' || result === null) {
    throw new Error('SDK text evaluation did not produce an object');
  }

  const obj = result as Record<string, unknown>;
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  // Nodes accepted in two shapes:
  //   - Array form (legacy): `nodes: [helper('ref', ...), ...]`. Each item
  //     is an `SdkFlowNode` with referenceId already set.
  //   - Named-record form (Phase 9 emitter output): `nodes: { ref: helper(...) }`.
  //     The key becomes the referenceId; the helper itself was called
  //     without a positional ref so produced `referenceId: ''`.
  const nodes: SdkFlowNode[] = [];
  if (Array.isArray(obj.nodes)) {
    for (const item of obj.nodes) {
      if (item !== null && item !== undefined && isSdkFlowNode(item)) {
        nodes.push(item);
      }
    }
  } else if (obj.nodes !== null && typeof obj.nodes === 'object') {
    for (const [key, value] of Object.entries(obj.nodes as Record<string, unknown>)) {
      if (value !== null && value !== undefined && isSdkFlowNodeShape(value)) {
        // Inject the key as referenceId — helpers called without a positional
        // ref leave the field empty.
        nodes.push({ ...(value as SdkFlowNode), referenceId: key });
      }
    }
  }

  const edges: SdkEdge[] = [];
  for (const item of rawEdges) {
    if (item !== null && item !== undefined && isSdkEdge(item)) {
      edges.push(item);
    }
  }

  return { nodes, edges };
}

/**
 * Looser SdkFlowNode check used for named-record values: the key supplies
 * the referenceId, so we only require `type` and `params`.
 */
function isSdkFlowNodeShape(item: unknown): boolean {
  return (
    typeof item === 'object' &&
    item !== null &&
    !Array.isArray(item) &&
    typeof (item as Record<string, unknown>).type === 'string'
  );
}
