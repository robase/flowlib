/**
 * Reconciliation pass — the second (and cleverer) of Mem0's two prompts.
 *
 * Given a new fact and the most-similar existing memories, the LLM
 * decides per memory among ADD / UPDATE / DELETE / NOOP so the store
 * stays self-correcting instead of accumulating contradictions.
 *
 * Anti-hallucination trick (the difference between working and silently
 * corrupting data): candidate UUIDs are mapped to small integers
 * (`0,1,2,…`) before being shown to the LLM, then translated back. LLMs
 * faithfully echo small ints but hallucinate long UUIDs.
 *
 * Port `DEFAULT_UPDATE_MEMORY_PROMPT` (Apache-2.0) verbatim into
 * `buildUpdatePrompt`; the scaffold below carries the call shape only.
 */

import type { MemoryLlm } from './types';

export type MemoryOp =
  | { event: 'ADD'; text: string }
  | { event: 'UPDATE'; id: string; text: string }
  | { event: 'DELETE'; id: string }
  | { event: 'NOOP' };

export const UPDATE_SYSTEM =
  'You reconcile a new fact against existing memories, deciding per memory ' +
  'whether to ADD, UPDATE, DELETE, or NOOP.';

export function buildUpdatePrompt(
  newFact: string,
  existing: ReadonlyArray<{ id: string; text: string }>,
): { system: string; prompt: string } {
  const prompt = [
    `New fact: ${newFact}`,
    'Existing memories (referenced by integer id):',
    JSON.stringify(existing, null, 2),
    // ADD (new, non-overlapping) · UPDATE (same subject, merge in place) ·
    // DELETE (new fact contradicts/obsoletes it) · NOOP (already captured).
    'Output strict JSON: { "memory": [{ "id": "<int>", "text": "<merged text>", ' +
      '"event": "ADD|UPDATE|DELETE|NOOP" }] }.',
  ].join('\n');
  return { system: UPDATE_SYSTEM, prompt };
}

/**
 * Decide the operations for one new fact against its candidate memories.
 *
 * - Maps candidate UUIDs → integers for the LLM, then back.
 * - Drops ops that reference an out-of-range / non-existent integer id.
 * - If the LLM returns no actionable op, defaults to ADD (a brand-new
 *   fact must not be silently dropped).
 */
export async function reconcileFact(
  llm: MemoryLlm,
  newFact: string,
  candidates: ReadonlyArray<{ id: string; text: string }>,
): Promise<MemoryOp[]> {
  const idByInt = candidates.map((c) => c.id);
  const view = candidates.map((c, n) => ({ id: String(n), text: c.text }));
  const { system, prompt } = buildUpdatePrompt(newFact, view);

  const res = await llm.json<{ memory?: unknown }>({ system, prompt });
  const decisions = Array.isArray((res as { memory?: unknown })?.memory)
    ? ((res as { memory: unknown[] }).memory as Array<Record<string, unknown>>)
    : [];

  const ops: MemoryOp[] = [];
  for (const d of decisions) {
    const event = String(d.event ?? '').toUpperCase();
    const text = typeof d.text === 'string' ? d.text.trim() : '';
    if (event === 'ADD' && text !== '') {
      ops.push({ event: 'ADD', text });
      continue;
    }
    if (event === 'UPDATE' || event === 'DELETE') {
      const uuid = idByInt[Number(d.id)];
      if (!uuid) {
        continue; // hallucinated / out-of-range id — drop it
      }
      if (event === 'UPDATE') {
        if (text !== '') {
          ops.push({ event: 'UPDATE', id: uuid, text });
        }
      } else {
        ops.push({ event: 'DELETE', id: uuid });
      }
      continue;
    }
    if (event === 'NOOP') {
      ops.push({ event: 'NOOP' });
    }
  }

  if (ops.length === 0) {
    // The LLM returned nothing usable (empty or all-hallucinated ids) —
    // keep the new fact rather than silently lose it. An explicit NOOP,
    // by contrast, produces a NOOP op and is respected here.
    return [{ event: 'ADD', text: newFact }];
  }
  return ops;
}
