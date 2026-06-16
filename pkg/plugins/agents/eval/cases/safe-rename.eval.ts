/**
 * Blast-radius rename — the agent must find ALL usages of a symbol (not just
 * its definition) before renaming, then verify the program still runs. This
 * is the "gauge the effect of a change" task the parity plan calls out:
 * grep usages → edit every site → run.
 *
 * Sandbox-gated (grep + run). Offline — plain `node:*` image, no deps.
 */

import { defineEvalCase } from '../src/index';
import { commandSucceeds, fileContains, turnSucceeded, usedTool } from '../src/scorers';

export default defineEvalCase({
  id: 'safe-rename',
  description: 'Renames a symbol across all call sites (blast radius) and verifies it runs.',
  requiresSandbox: true,
  systemPrompt:
    'You are a coding assistant working in a sandbox. Before changing a symbol, ' +
    'search for every usage so you update all call sites, then run the program ' +
    'to confirm it still works.',
  prompt:
    'Rename the function `addNumbers` to `sum` everywhere it is used, keeping ' +
    'behaviour identical. Then run `node main.js` to confirm it still works.',
  files: {
    'src/math.js':
      'function addNumbers(a, b) {\n  return a + b;\n}\nmodule.exports = { addNumbers };\n',
    'main.js':
      "const { addNumbers } = require('./src/math');\n" +
      'console.log(addNumbers(2, 3));\n',
  },
  timeoutMs: 180_000,
  scorers: [
    usedTool('sandbox.grep'), // gauged blast radius before editing
    fileContains('src/math.js', /function sum\b/), // renamed the definition
    fileContains('main.js', /\bsum\(/), // updated the call site
    commandSucceeds('! grep -rq addNumbers src main.js'), // no stale references remain
    commandSucceeds('node main.js'), // program still runs
    turnSucceeded(),
  ],
});
