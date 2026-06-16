/**
 * Conversational baseline: a trivial question the agent should answer
 * directly — no tools, no preamble. Catches a system prompt that pushes
 * the agent to over-tool or over-explain simple turns.
 */

import { defineEvalCase } from '../src/index';
import { answeredDirectly, finalTextContains, turnSucceeded } from '../src/scorers';

export default defineEvalCase({
  id: 'direct-answer',
  description: 'Answers a trivial question directly, without calling tools.',
  systemPrompt: 'You are a concise, helpful coding assistant.',
  prompt: 'What is 2 + 2? Reply with just the number.',
  scorers: [turnSucceeded(), answeredDirectly(), finalTextContains('4')],
});
