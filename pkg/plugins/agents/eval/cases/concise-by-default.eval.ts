/**
 * Conversational quality: the agent should be concise by default. A common
 * regression when the system prompt accumulates "be thorough" boilerplate
 * that bleeds into trivial turns. Sampled 3× because conciseness is a soft,
 * stochastic property — we want a stable signal, not a single coin flip.
 */

import { defineEvalCase } from '../src/index';
import { answeredDirectly, llmJudge } from '../src/scorers';

export default defineEvalCase({
  id: 'concise-by-default',
  description: 'Answers a simple conceptual question concisely, no padding.',
  systemPrompt: 'You are a concise, helpful coding assistant.',
  prompt: 'In one sentence, what is a race condition?',
  samples: 3,
  minPassRate: 0.66, // ≥2/3 samples
  scorers: [
    answeredDirectly(),
    llmJudge({
      rubric:
        'The answer should be a correct, single-sentence definition of a race condition ' +
        'with no preamble ("Great question!"), no bullet lists, and no unsolicited tangents. ' +
        'Score 5 for a crisp one-sentence answer; drop a point for each unnecessary ' +
        'sentence or padding phrase.',
      passThreshold: 4,
    }),
  ],
});
