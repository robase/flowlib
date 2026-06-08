/**
 * Extraction pass — the first of Mem0's two LLM prompts.
 *
 * Distils a conversation into discrete, self-contained, durable facts
 * **before** anything is embedded or stored. The full
 * `ADDITIVE_EXTRACTION_PROMPT` (~480 lines, Apache-2.0) should be ported
 * verbatim; the scaffold below carries the call shape and the invariants
 * the port must preserve — it is NOT a substitute for the real prompt.
 */

import type { ExtractedFact, MemoryLlm } from './types';

export const EXTRACTION_SYSTEM =
  'You extract durable, self-contained memories from a conversation. ' +
  'Return only facts worth remembering for future turns.';

/** Build the extraction prompt. `observationDate` anchors relative time. */
export function buildExtractionPrompt(
  messages: ReadonlyArray<{ role: string; content: string }>,
  observationDate: string,
): { system: string; prompt: string } {
  const convo = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  const prompt = [
    `Observation date: ${observationDate}.`,
    // INVARIANTS the full prompt enforces — preserve all of them on port:
    // • Self-contained: resolve pronouns ("User", not "they").
    // • Contextually rich, not atomic: capture cause/relationship.
    // • Temporally grounded: relative time → absolute date vs observation date.
    // • Detail-preserving: never generalise proper nouns or round numbers.
    // • Echo suppression: don't store the assistant restating the user.
    'Extract durable facts from the conversation below.',
    'Output strict JSON: { "facts": [{ "text": string, "entities"?: string[] }] }.',
    '',
    convo,
  ].join('\n');
  return { system: EXTRACTION_SYSTEM, prompt };
}

/**
 * Run the extraction LLM call and return validated facts. Malformed
 * entries (missing/blank `text`) are dropped; a non-conforming response
 * yields `[]` rather than throwing.
 */
export async function extractFacts(
  llm: MemoryLlm,
  messages: ReadonlyArray<{ role: string; content: string }>,
  observationDate: string,
): Promise<ExtractedFact[]> {
  const { system, prompt } = buildExtractionPrompt(messages, observationDate);
  const res = await llm.json<{ facts?: unknown }>({ system, prompt });
  const facts = (res as { facts?: unknown })?.facts;
  if (!Array.isArray(facts)) {
    return [];
  }
  const out: ExtractedFact[] = [];
  for (const f of facts) {
    if (f && typeof (f as ExtractedFact).text === 'string') {
      const text = (f as ExtractedFact).text.trim();
      if (text === '') {
        continue;
      }
      const entities = (f as ExtractedFact).entities;
      out.push({
        text,
        ...(Array.isArray(entities)
          ? { entities: entities.filter((e) => typeof e === 'string') }
          : {}),
      });
    }
  }
  return out;
}
