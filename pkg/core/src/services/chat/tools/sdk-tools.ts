/**
 * Source-level chat tools — the Phase 7 entry point for the chat assistant's
 * SDK-file editing mode.
 *
 * Three tools replace the bulk of the granular JSON-patch toolkit:
 *
 *   - `get_flow_source` — returns the current flow as canonical `@flowlib/sdk`
 *     TypeScript source. What the LLM reads.
 *   - `edit_flow_source` — str_replace-style edit against the emitted source.
 *     Re-evaluates, transforms arrows → strings, merges into the prior DB
 *     definition (preserving ids/positions/instanceIds), saves a new version.
 *   - `write_flow_source` — full rewrite. Same pipeline, just no str_replace.
 *
 * The save pipeline is identical for edit + write — both funnel through
 * `saveFlowFromSource` below. The granular JSON-patch tools (`add_node`,
 * `update_node_config`, etc.) stay registered alongside as a targeted
 * fallback for flows the round-trip can't handle today (e.g. provider actions
 * whose params contain complex JSON structures the LLM might misformat).
 */

import { z } from 'zod/v4';
import { emitSdkSource } from '@flowlib/sdk';
import { evaluateSdkSource, typecheckSdkSource } from '@flowlib/sdk/evaluator';
import { transformArrowsToStrings } from '@flowlib/sdk/transform';
import { mergeParsedIntoDefinition } from '@flowlib/sdk';
import type { DbFlowDefinition, NodeSpan } from '@flowlib/sdk';
import type { ChatToolContext, ChatToolDefinition, ChatToolResult } from '../chat-types';
import type { InvectInstance } from 'src/api/types';

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers: hashing, failure payloads, node index
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Max emitted-source length (characters) we'll embed in a failure payload. Past
 * this threshold the tool omits `currentSource` and relies on `nodeIndex` +
 * `closestMatches`; the LLM can call `get_flow_source` for the whole thing.
 * Keeps retries from blowing through the 100K-token conversation budget.
 */
const SOURCE_INCLUDE_BUDGET = 8000;

async function sha1(input: string): Promise<string> {
  // WebCrypto exposes SHA-1 (legacy but still defined) — used solely as a short
  // content-fingerprint for read-state invariants, not for security. Routed
  // through `crypto.subtle.digest` so this runs unchanged on Workers/Deno/Bun.
  // Copy into a fresh ArrayBuffer to satisfy WebCrypto's `BufferSource` type.
  const data = new TextEncoder().encode(input).slice().buffer;
  const digest = await crypto.subtle.digest('SHA-1', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

interface NodeIndexEntry extends NodeSpan {
  type: string;
  paramKeys: string[];
}

function buildNodeIndex(
  def: DbFlowDefinition,
  nodeSpans: Record<string, NodeSpan>,
): Record<string, NodeIndexEntry> {
  const index: Record<string, NodeIndexEntry> = {};
  for (const node of def.nodes) {
    const ref = node.referenceId ?? node.id;
    const span = nodeSpans[ref];
    if (!span) {
      continue;
    }
    index[ref] = {
      start: span.start,
      end: span.end,
      type: node.type,
      paramKeys: Object.keys(node.params ?? {}),
    };
  }
  return index;
}

interface FuzzyMatch {
  text: string;
  startLine: number;
  endLine: number;
  similarity: number;
}

/**
 * Find the top-k line ranges in `source` whose tokens best overlap with
 * `needle`. Cheap heuristic — tokenize both, score each line by shared-token
 * ratio, and return 3-line context windows around the best-scoring lines.
 * Good enough to give the LLM a recovery hint; not meant to replace a real
 * diff.
 */
function findClosestMatches(source: string, needle: string, k: number): FuzzyMatch[] {
  const needleTokens = tokenize(needle);
  if (needleTokens.size === 0) {
    return [];
  }
  const lines = source.split('\n');

  const scored: Array<{ line: number; similarity: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const lineTokens = tokenize(lines[i]);
    if (lineTokens.size === 0) {
      continue;
    }
    let shared = 0;
    for (const t of lineTokens) {
      if (needleTokens.has(t)) {
        shared++;
      }
    }
    if (shared === 0) {
      continue;
    }
    const similarity = shared / needleTokens.size;
    scored.push({ line: i, similarity });
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  const picked: FuzzyMatch[] = [];
  const usedLines = new Set<number>();
  for (const s of scored) {
    if (picked.length >= k) {
      break;
    }
    if (usedLines.has(s.line)) {
      continue;
    }
    const windowStart = Math.max(0, s.line - 1);
    const windowEnd = Math.min(lines.length - 1, s.line + 1);
    for (let i = windowStart; i <= windowEnd; i++) {
      usedLines.add(i);
    }
    picked.push({
      text: lines.slice(windowStart, windowEnd + 1).join('\n'),
      startLine: windowStart + 1,
      endLine: windowEnd + 1,
      similarity: Number(s.similarity.toFixed(3)),
    });
  }
  return picked;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length >= 3),
  );
}

interface AmbiguousMatch {
  startLine: number;
  endLine: number;
  contextSnippet: string;
}

function findAllMatchLocations(source: string, needle: string): AmbiguousMatch[] {
  const results: AmbiguousMatch[] = [];
  const lines = source.split('\n');
  let fromIdx = 0;
  while (true) {
    const idx = source.indexOf(needle, fromIdx);
    if (idx === -1) {
      break;
    }
    const startLine = source.slice(0, idx).split('\n').length;
    const needleLineCount = needle.split('\n').length;
    const endLine = startLine + needleLineCount - 1;
    const ctxStart = Math.max(0, startLine - 2);
    const ctxEnd = Math.min(lines.length - 1, endLine);
    results.push({
      startLine,
      endLine,
      contextSnippet: lines.slice(ctxStart, ctxEnd + 1).join('\n'),
    });
    fromIdx = idx + needle.length;
    if (results.length > 10) {
      break;
    }
  }
  return results;
}

/** Load + emit canonical source. Shared by `get_flow_source` and the edit
 *  tools so they stay in sync on emit options. */
async function emitCurrentSource(
  flowlib: InvectInstance,
  flowId: string,
): Promise<
  | { ok: true; code: string; nodeSpans: Record<string, NodeSpan>; def: DbFlowDefinition }
  | { ok: false; error: string }
> {
  try {
    const [flow, version] = await Promise.all([
      flowlib.flows.get(flowId),
      flowlib.versions.get(flowId, 'latest'),
    ]);
    if (!version?.invectDefinition) {
      return { ok: false, error: 'Flow has no versions yet' };
    }
    const def = version.invectDefinition as DbFlowDefinition;
    const { code, nodeSpans } = emitSdkSource(def, {
      flowName: toFlowExportName(flow.name),
      metadata: {
        name: flow.name,
        ...(flow.description ? { description: flow.description } : {}),
        ...(flow.tags && flow.tags.length > 0 ? { tags: flow.tags } : {}),
      },
    });
    return { ok: true, code, nodeSpans, def };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to emit flow source: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

interface FailurePayloadInput {
  reason:
    | 'not_found'
    | 'ambiguous'
    | 'stale_or_missing_read'
    | 'source_changed_since'
    | 'eval_failed'
    | 'merge_failed';
  source: string;
  sourceHash: string;
  def: DbFlowDefinition;
  nodeSpans: Record<string, NodeSpan>;
  needle?: string;
}

interface FailurePayload {
  reason: FailurePayloadInput['reason'];
  sourceHash: string;
  availableReferenceIds: string[];
  nodeIndex: Record<string, NodeIndexEntry>;
  currentSource?: string;
  sourceElided?: boolean;
  closestMatches?: FuzzyMatch[];
  matchLocations?: AmbiguousMatch[];
}

function buildFailurePayload(input: FailurePayloadInput): FailurePayload {
  const availableReferenceIds = input.def.nodes.map((n) => n.referenceId ?? n.id);
  const nodeIndex = buildNodeIndex(input.def, input.nodeSpans);
  const payload: FailurePayload = {
    reason: input.reason,
    sourceHash: input.sourceHash,
    availableReferenceIds,
    nodeIndex,
  };
  if (input.source.length <= SOURCE_INCLUDE_BUDGET) {
    payload.currentSource = input.source;
  } else {
    payload.sourceElided = true;
  }
  if (input.reason === 'not_found' && input.needle) {
    payload.closestMatches = findClosestMatches(input.source, input.needle, 3);
  }
  if (input.reason === 'ambiguous' && input.needle) {
    payload.matchLocations = findAllMatchLocations(input.source, input.needle);
  }
  return payload;
}

function logEditFailure(
  ctx: ChatToolContext,
  tool: string,
  reason: FailurePayloadInput['reason'],
  extra: Record<string, unknown> = {},
): void {
  ctx.logger?.warn(`chat-assistant source edit failed: ${tool} / ${reason}`, {
    tool,
    reason,
    flowId: ctx.chatContext.flowId,
    step: ctx.currentStep,
    ...extra,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// get_flow_source
// ═══════════════════════════════════════════════════════════════════════════

export const getFlowSourceTool: ChatToolDefinition = {
  id: 'get_flow_source',
  name: 'Get Flow Source',
  description:
    'Return the current flow as canonical TypeScript source using the @flowlib/sdk. ' +
    'The source is what FlowCodePanel shows, what users hand-author, and what copy-paste / git sync produce. ' +
    'Prefer this over the granular JSON-inspection tools when reasoning about the flow as a whole. ' +
    'Call this before any `edit_flow_source` / `write_flow_source` — those tools require a read in the current turn.',
  parameters: z.object({}),
  async execute(_params, ctx): Promise<ChatToolResult> {
    const flowId = ctx.chatContext.flowId;
    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const [flow, version] = await Promise.all([
        ctx.flowlib.flows.get(flowId),
        ctx.flowlib.versions.get(flowId, 'latest'),
      ]);
      if (!version?.invectDefinition) {
        return {
          success: false,
          error: 'Flow has no versions yet — create the initial definition first',
        };
      }

      const def = version.invectDefinition as DbFlowDefinition;
      const { code, sdkImports, actionImports, nodeSpans } = emitSdkSource(def, {
        flowName: toFlowExportName(flow.name),
        metadata: {
          name: flow.name,
          ...(flow.description ? { description: flow.description } : {}),
          ...(flow.tags && flow.tags.length > 0 ? { tags: flow.tags } : {}),
        },
      });

      const sourceHash = await sha1(code);
      // Record the read for this turn so subsequent edits can verify the
      // invariant. Cross-turn state is intentionally not tracked.
      if (ctx.readState && ctx.currentStep !== undefined) {
        ctx.readState.set(flowId, { hash: sourceHash, readAtStep: ctx.currentStep });
      }

      return {
        success: true,
        data: {
          source: code,
          sourceHash,
          availableReferenceIds: def.nodes.map((n) => n.referenceId ?? n.id),
          nodeIndex: buildNodeIndex(def, nodeSpans),
          flowId,
          versionNumber: version.version,
          nodeCount: def.nodes.length,
          edgeCount: def.edges.length,
          imports: { sdk: sdkImports, actions: actionImports },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to emit flow source: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// edit_flow_source
// ═══════════════════════════════════════════════════════════════════════════

export const editFlowSourceTool: ChatToolDefinition = {
  id: 'edit_flow_source',
  name: 'Edit Flow Source',
  description:
    'Apply a str_replace-style edit to the current flow source. ' +
    'REQUIRES a prior `get_flow_source` call in this turn — otherwise the tool returns the fresh source without attempting the edit. ' +
    'Both `oldString` and `newString` must match the emitted source verbatim (whitespace-sensitive). ' +
    'The edit must identify `oldString` unambiguously — include enough surrounding context for the match to be unique. ' +
    'After the edit, the full source is evaluated, **typechecked** with the real TypeScript compiler, arrow functions are serialised back to strings for QuickJS storage, ' +
    'and the result is merged into the prior DB version (preserving node ids, positions, and agent-tool instance ids). ' +
    'Type errors (wrong handles, missing fields, unknown referenceIds, bad types) reject the save with line-numbered diagnostics — fix and retry. ' +
    'For single-node parameter changes prefer `update_node_config`; this tool is for multi-node refactors.',
  parameters: z.object({
    oldString: z
      .string()
      .min(1)
      .describe(
        'Exact substring of the current flow source to replace. Must be unique in the source — include surrounding context if the literal appears multiple times.',
      ),
    newString: z.string().describe('Replacement text. May be empty to delete `oldString`.'),
  }),
  async execute(params, ctx): Promise<ChatToolResult> {
    const { oldString, newString } = params as { oldString: string; newString: string };
    const flowId = ctx.chatContext.flowId;
    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    const emitted = await emitCurrentSource(ctx.flowlib, flowId);
    if (!emitted.ok) {
      return {
        success: false,
        error: emitted.error,
        suggestion:
          'Use `write_flow_source` to seed the initial definition if the flow has no versions yet.',
      };
    }
    const { code: currentSource, nodeSpans, def } = emitted;
    const currentHash = await sha1(currentSource);

    // Read-before-edit invariant: only enforced when the caller (the session)
    // provides a `readState` map. Callers without it (tests, direct programmatic
    // use) opt out of the invariant.
    if (ctx.readState) {
      const priorRead = ctx.readState.get(flowId);
      if (!priorRead) {
        logEditFailure(ctx, 'edit_flow_source', 'stale_or_missing_read');
        // Update read-state so the LLM's immediate retry succeeds without
        // needing a separate `get_flow_source` call.
        if (ctx.currentStep !== undefined) {
          ctx.readState.set(flowId, { hash: currentHash, readAtStep: ctx.currentStep });
        }
        return {
          success: false,
          error:
            'edit_flow_source requires a `get_flow_source` call earlier in this turn. The current source is attached — inspect it and call edit_flow_source again.',
          data: buildFailurePayload({
            reason: 'stale_or_missing_read',
            source: currentSource,
            sourceHash: currentHash,
            def,
            nodeSpans,
          }),
        };
      }

      // Hash drift: source changed since the LLM's last read (e.g. a prior
      // `update_node_config` saved a new version). Soft re-prime rather than
      // erroring — the LLM's reasoning may still be valid against the new text.
      if (priorRead.hash !== currentHash) {
        logEditFailure(ctx, 'edit_flow_source', 'source_changed_since', {
          priorReadStep: priorRead.readAtStep,
        });
        if (ctx.currentStep !== undefined) {
          ctx.readState.set(flowId, { hash: currentHash, readAtStep: ctx.currentStep });
        }
        return {
          success: false,
          error:
            'The flow source has changed since your last `get_flow_source` call (likely because a prior edit saved a new version). The fresh source is attached — re-apply your edit against it.',
          data: buildFailurePayload({
            reason: 'source_changed_since',
            source: currentSource,
            sourceHash: currentHash,
            def,
            nodeSpans,
          }),
        };
      }
    }

    // Validate `oldString` uniqueness against the emitted source.
    const firstIdx = currentSource.indexOf(oldString);
    if (firstIdx === -1) {
      logEditFailure(ctx, 'edit_flow_source', 'not_found', {
        needleLength: oldString.length,
      });
      return {
        success: false,
        error: '`oldString` was not found in the current flow source',
        suggestion:
          'Check `availableReferenceIds` — if the node you want to edit is not listed, it does not exist. Otherwise see `closestMatches` for similar lines and include enough context to match the source verbatim.',
        data: buildFailurePayload({
          reason: 'not_found',
          source: currentSource,
          sourceHash: currentHash,
          def,
          nodeSpans,
          needle: oldString,
        }),
      };
    }
    const secondIdx = currentSource.indexOf(oldString, firstIdx + 1);
    if (secondIdx !== -1) {
      logEditFailure(ctx, 'edit_flow_source', 'ambiguous', {
        needleLength: oldString.length,
      });
      return {
        success: false,
        error:
          '`oldString` appears multiple times in the source — add more surrounding context so it is unique',
        suggestion:
          "See `matchLocations` for every occurrence; include surrounding lines (e.g. the containing node's declaration) so `oldString` uniquely identifies one location.",
        data: buildFailurePayload({
          reason: 'ambiguous',
          source: currentSource,
          sourceHash: currentHash,
          def,
          nodeSpans,
          needle: oldString,
        }),
      };
    }

    const newSource =
      currentSource.slice(0, firstIdx) +
      newString +
      currentSource.slice(firstIdx + oldString.length);

    // Evaluate + transform + merge + save. On success the stored state changes,
    // so clear this flow's read-state; the next edit will need a fresh read.
    const result = await saveFlowFromSource(ctx.flowlib, flowId, newSource, def);
    if (result.success) {
      ctx.readState?.delete(flowId);
    } else {
      // Promote stage-specific failures into the telemetry stream.
      const stage = (result.data as { stage?: string } | undefined)?.stage;
      if (stage === 'evaluate') {
        logEditFailure(ctx, 'edit_flow_source', 'eval_failed');
      } else if (stage === 'merge') {
        logEditFailure(ctx, 'edit_flow_source', 'merge_failed');
      }
    }
    return result;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// write_flow_source
// ═══════════════════════════════════════════════════════════════════════════

export const writeFlowSourceTool: ChatToolDefinition = {
  id: 'write_flow_source',
  name: 'Write Flow Source',
  description:
    'Replace the entire flow with the provided TypeScript source. ' +
    'Use this for new flows or when making several coordinated edits that would be awkward as individual `edit_flow_source` calls. ' +
    'For flows that already have a version, this tool REQUIRES a prior `get_flow_source` call in this turn. ' +
    'The source must be a complete `@flowlib/sdk` flow file. Use the **named-record** form for nodes — keys are referenceIds, edges narrow `from`/`to`/`handle` against them. Example:\n\n' +
    '```ts\n' +
    "import { defineFlow, input, output, ifElse } from '@flowlib/sdk';\n" +
    "import { gmail } from '@flowlib/sdk/actions';\n\n" +
    'export default defineFlow({\n' +
    '  name: "Triage email",\n' +
    '  nodes: {\n' +
    '    event:    input(),\n' +
    '    classify: ifElse({ condition: "{{ event.priority > 5 }}" }),\n' +
    '    notify:   gmail.sendMessage({ credentialId: "{{ env.GMAIL }}", to: "x@y.z", subject: "Alert", body: "{{ event.message }}" }),\n' +
    '    log:      output({ value: "logged" }),\n' +
    '  },\n' +
    '  edges: [\n' +
    '    { from: "event",    to: "classify" },\n' +
    '    { from: "classify", to: "notify", handle: "true_output" },\n' +
    '    { from: "classify", to: "log",    handle: "false_output" },\n' +
    '  ],\n' +
    '});\n' +
    '```\n\n' +
    'The source is **typechecked** before save. Wrong handles, unknown referenceIds, missing required fields, and bad types are rejected with line-numbered diagnostics. ' +
    'Node ids, canvas positions, and agent-tool instance ids are preserved from the prior version by matching on `referenceId`.',
  parameters: z.object({
    source: z
      .string()
      .min(1)
      .describe(
        'Complete TypeScript source for the flow. Must include imports from @flowlib/sdk and an `export default defineFlow({...})`. ' +
          'Use the named-record form `nodes: { ref: helper(...) }` and object-form edges `{ from, to, handle? }`.',
      ),
  }),
  async execute(params, ctx): Promise<ChatToolResult> {
    const { source } = params as { source: string };
    const flowId = ctx.chatContext.flowId;
    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      // Prior definition is used by the merge step for id/position/instanceId
      // preservation. Brand-new flows (no prior version) skip the invariant —
      // there's nothing to read.
      let priorDef: DbFlowDefinition | null = null;
      try {
        const version = await ctx.flowlib.versions.get(flowId, 'latest');
        if (version?.invectDefinition) {
          priorDef = version.invectDefinition as DbFlowDefinition;
        }
      } catch {
        // No prior version — fine; merge will generate fresh ids.
      }

      // Read-before-edit invariant: enforced only when the session wires a
      // `readState` map AND a prior version exists. Brand-new flows skip.
      if (priorDef && ctx.readState) {
        const emitted = await emitCurrentSource(ctx.flowlib, flowId);
        if (emitted.ok) {
          const currentHash = await sha1(emitted.code);
          const priorRead = ctx.readState.get(flowId);
          if (!priorRead) {
            logEditFailure(ctx, 'write_flow_source', 'stale_or_missing_read');
            if (ctx.currentStep !== undefined) {
              ctx.readState.set(flowId, { hash: currentHash, readAtStep: ctx.currentStep });
            }
            return {
              success: false,
              error:
                'write_flow_source requires a `get_flow_source` call earlier in this turn (for flows with an existing version). The current source is attached — inspect it and call write_flow_source again.',
              data: buildFailurePayload({
                reason: 'stale_or_missing_read',
                source: emitted.code,
                sourceHash: currentHash,
                def: emitted.def,
                nodeSpans: emitted.nodeSpans,
              }),
            };
          }
          if (priorRead.hash !== currentHash) {
            logEditFailure(ctx, 'write_flow_source', 'source_changed_since', {
              priorReadStep: priorRead.readAtStep,
            });
            if (ctx.currentStep !== undefined) {
              ctx.readState.set(flowId, { hash: currentHash, readAtStep: ctx.currentStep });
            }
            return {
              success: false,
              error:
                'The flow source has changed since your last `get_flow_source` call. The fresh source is attached — re-apply your rewrite against it.',
              data: buildFailurePayload({
                reason: 'source_changed_since',
                source: emitted.code,
                sourceHash: currentHash,
                def: emitted.def,
                nodeSpans: emitted.nodeSpans,
              }),
            };
          }
        }
      }

      const result = await saveFlowFromSource(ctx.flowlib, flowId, source, priorDef);
      if (result.success) {
        ctx.readState?.delete(flowId);
      } else {
        const stage = (result.data as { stage?: string } | undefined)?.stage;
        if (stage === 'evaluate') {
          logEditFailure(ctx, 'write_flow_source', 'eval_failed');
        } else if (stage === 'merge') {
          logEditFailure(ctx, 'write_flow_source', 'merge_failed');
        }
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: `Write failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Shared save pipeline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate SDK source → extract arrow bodies → merge into prior DB state →
 * save a new flow version. Each stage returns its diagnostics on failure so
 * the LLM can see exactly what went wrong.
 */
async function saveFlowFromSource(
  flowlib: InvectInstance,
  flowId: string,
  source: string,
  priorDef: DbFlowDefinition | null,
): Promise<ChatToolResult> {
  // 1. Evaluate — parse + execute the SDK source, gets us a structured flow.
  const evalResult = await evaluateSdkSource(source);
  if (!evalResult.ok || !evalResult.flow) {
    return {
      success: false,
      error: 'Flow source did not evaluate successfully',
      data: { stage: 'evaluate', errors: evalResult.errors },
      suggestion: formatEvalSuggestion(evalResult.errors),
    };
  }

  // 1b. Typecheck — feed the source into the real TypeScript compiler so
  //     LLM-generated source has to be type-safe before it can save. Catches
  //     wrong handle ids, unknown referenceIds, missing required fields,
  //     wrong types, etc. — the same errors a human would see in the
  //     editor. Non-trivial cold-path (~200ms) but bounded; the LLM is
  //     network-paced anyway.
  const tcResult = await typecheckSdkSource(source);
  if (!tcResult.ok) {
    return {
      success: false,
      error: 'Flow source has TypeScript errors — fix and retry',
      data: { stage: 'typecheck', diagnostics: tcResult.diagnostics },
      suggestion: formatTypecheckSuggestion(tcResult.diagnostics),
    };
  }

  // 2. Transform — arrow functions → QuickJS-compatible string expressions.
  const transformResult = transformArrowsToStrings(evalResult.flow.nodes);
  if (!transformResult.ok) {
    return {
      success: false,
      error: 'Flow source contains arrow expressions that cannot be stored (see diagnostics)',
      data: { stage: 'transform', diagnostics: transformResult.diagnostics },
      suggestion:
        'Rewrite the flagged expressions to avoid closures over outer variables, async/await, loops, or try/catch.',
    };
  }

  // 3. Merge — preserve DB ids, positions, and agent-tool instanceIds where
  //    referenceIds match the prior version. Brand-new nodes get fresh ids.
  let merged: DbFlowDefinition;
  try {
    merged = mergeParsedIntoDefinition(
      {
        nodes: transformResult.nodes,
        edges: evalResult.flow.edges,
        metadata: evalResult.flow.metadata,
      },
      priorDef,
    );
  } catch (error) {
    return {
      success: false,
      error: `Merge failed: ${error instanceof Error ? error.message : String(error)}`,
      data: { stage: 'merge' },
    };
  }

  // 4. Save — publish a new flow version via the standard versions API.
  //    The `DbFlowDefinition` from `@flowlib/sdk` is structurally compatible
  //    with core's Zod-typed `InvectDefinition`; the cast bridges the
  //    weaker-types-at-the-boundary gap without a runtime conversion.
  try {
    const version = await flowlib.versions.create(flowId, {
      invectDefinition: merged as unknown as Parameters<
        typeof flowlib.versions.create
      >[1]['invectDefinition'],
    });
    return {
      success: true,
      data: {
        flowId,
        versionNumber: version.version,
        nodeCount: merged.nodes.length,
        edgeCount: merged.edges.length,
      },
      uiAction: { action: 'refresh_flow', data: { flowId } },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to save new flow version: ${error instanceof Error ? error.message : String(error)}`,
      data: { stage: 'save' },
    };
  }
}

function formatEvalSuggestion(errors: Array<{ code: string; message: string }>): string {
  const codes = new Set(errors.map((e) => e.code));
  if (codes.has('import-forbidden')) {
    return 'Only imports from @flowlib/sdk, @flowlib/action-kit, and @flowlib/actions/* are allowed in flow source.';
  }
  if (codes.has('dynamic-import')) {
    return 'Dynamic `import()` is not allowed — use top-level import statements only.';
  }
  if (codes.has('no-default-export')) {
    return 'Flow source must export the flow as default: `export default defineFlow({...})`.';
  }
  if (codes.has('default-export-not-a-flow')) {
    return 'The default export must be the return value of defineFlow({...}).';
  }
  return 'Review the errors and regenerate the flow source.';
}

/**
 * Format typecheck diagnostics into a single-line suggestion the LLM can
 * act on. Most errors land on the `defineFlow(...)` call line because the
 * overload-match-failure surfaces there; the diagnostic message itself
 * names the exact field/handle/type that's wrong, so just pass it through.
 */
function formatTypecheckSuggestion(
  diagnostics: Array<{ line: number; column: number; message: string; code: number }>,
): string {
  if (diagnostics.length === 0) {
    return '';
  }
  const head = diagnostics[0];
  const more = diagnostics.length > 1 ? ` (+${diagnostics.length - 1} more)` : '';
  // Trim deep overload-mismatch chatter; the first line of the message
  // usually identifies the offending field. Diagnostic codes 2769 (no
  // overload matches) emit multi-paragraph chains — the LLM needs the
  // first line plus the most specific assignment-failure clause.
  const firstLine = head.message.split('\n', 1)[0];
  const assignClause = head.message.match(/Type '[^']+' is not assignable to type '[^']+'\.?/);
  const tail = assignClause && !firstLine.includes(assignClause[0]) ? ` ${assignClause[0]}` : '';
  return `Line ${head.line}: ${firstLine}${tail}${more}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a human-entered flow name into a JS-safe export identifier for the
 * emitter. Non-alphanumeric runs collapse to camelCase; leading digits get
 * prefixed with `_`; a trailing `Flow` is added when absent so generated
 * names read naturally as `myFlow`, `greetingFlow`, etc.
 *
 * Mirrors the helper the sync plugin uses so chat-emitted and sync-emitted
 * flow files produce identical exports.
 */
function toFlowExportName(raw: string): string {
  const segments = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (segments.length === 0) {
    return 'myFlow';
  }
  const camel = segments
    .map((s, i) =>
      i === 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join('');
  const base = /^[0-9]/.test(camel) ? `_${camel}` : camel;
  return /[Ff]low$/.test(base) ? base : `${base}Flow`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export bundle
// ═══════════════════════════════════════════════════════════════════════════

export const sdkTools: ChatToolDefinition[] = [
  getFlowSourceTool,
  editFlowSourceTool,
  writeFlowSourceTool,
];
