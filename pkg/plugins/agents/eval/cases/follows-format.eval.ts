/**
 * Instruction-following: the agent must honour an exact output-format
 * constraint. A common regression when the system prompt grows chatty or
 * adds boilerplate sign-offs.
 */

import { defineEvalCase } from '../src/index';
import { answeredDirectly, finalTextMatches } from '../src/scorers';

export default defineEvalCase({
  id: 'follows-format',
  description: 'Obeys an exact output-format instruction with no extra prose.',
  systemPrompt: 'You are a concise, helpful coding assistant.',
  prompt: 'Respond with exactly the single word READY and nothing else.',
  scorers: [answeredDirectly(), finalTextMatches(/^\s*READY\s*$/i)],
});
