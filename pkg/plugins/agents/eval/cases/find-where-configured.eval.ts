/**
 * "Where is X configured?" — the everyday code-navigation task. The agent
 * must locate a value buried among decoys (grep, not guessing), then report
 * the file + value. Exercises the search→read→answer loop without any edit.
 *
 * Sandbox-gated (real shell for grep). Offline — plain `node:*` image.
 */

import { defineEvalCase } from '../src/index';
import {
  completedWithin,
  finalTextContains,
  finalTextMatches,
  turnSucceeded,
  usedTool,
} from '../src/scorers';

export default defineEvalCase({
  id: 'find-where-configured',
  description: 'Finds where a config value lives (grep), and reports the file + value.',
  requiresSandbox: true,
  systemPrompt:
    'You are a coding assistant working in a sandbox. Use search tools to find ' +
    'code rather than guessing paths. Answer concisely with the file and value.',
  prompt:
    'What is the HTTP request timeout (in milliseconds) and which file sets it? ' +
    'State the exact number and the file path.',
  files: {
    'config/server.js':
      'module.exports = {\n  port: 8080,\n  requestTimeoutMs: 30000,\n  maxRetries: 3,\n};\n',
    'src/client.js':
      "const { requestTimeoutMs } = require('../config/server');\n" +
      'function makeClient() {\n  return { timeout: requestTimeoutMs };\n}\n' +
      'module.exports = { makeClient };\n',
    'src/util/retry.js':
      '// Retries are unrelated to the request timeout — decoy.\n' +
      'const DEFAULT_BACKOFF_MS = 250;\nmodule.exports = { DEFAULT_BACKOFF_MS };\n',
    'README.md': '# Service\n\nConfigurable via `config/server.js`.\n',
  },
  timeoutMs: 120_000,
  scorers: [
    usedTool('sandbox.grep'), // found it by searching, not guessing
    finalTextMatches(/30[_,]?000/), // reported the value
    finalTextContains('config/server.js'), // reported the right file
    completedWithin({ maxToolCalls: 15 }),
    turnSucceeded(),
  ],
});
