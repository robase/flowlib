/**
 * The verification loop — the core of being good at code: read the failure,
 * find the bug, fix it, confirm the test passes. Needs a real shell, so it's
 * `requiresSandbox` (run with `pnpm eval --sandbox`).
 *
 * The seeded `add` returns `a - b` (bug); the test asserts `add(2, 3) === 5`.
 * The agent must edit `src/add.js` so `node test.js` exits 0 — which the
 * `commandSucceeds` scorer verifies in the post-run container. No deps to
 * install, so it runs offline on a plain `node:*` image.
 */

import { defineEvalCase } from '../src/index';
import { commandSucceeds, fileContains, turnSucceeded, usedTool } from '../src/scorers';

export default defineEvalCase({
  id: 'fix-failing-test',
  description: 'Reads a failing test, fixes the bug, and verifies the fix passes.',
  requiresSandbox: true,
  systemPrompt:
    'You are a coding assistant working in a sandbox. Read files before editing, ' +
    'and run the tests to confirm your change works before finishing.',
  prompt:
    'Running `node test.js` fails. Find the bug, fix it, and make the test pass. ' +
    'Run the test to confirm.',
  files: {
    'src/add.js': 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
    'test.js':
      "const assert = require('assert');\n" +
      "const { add } = require('./src/add');\n" +
      "assert.strictEqual(add(2, 3), 5, 'add(2, 3) should be 5');\n" +
      "console.log('PASS');\n",
  },
  timeoutMs: 180_000,
  scorers: [
    usedTool('sandbox.read_file'), // oriented before editing
    fileContains('src/add.js', /a \+ b/), // applied the actual fix
    commandSucceeds('node test.js'), // the verification-loop assertion
    turnSucceeded(),
  ],
});
