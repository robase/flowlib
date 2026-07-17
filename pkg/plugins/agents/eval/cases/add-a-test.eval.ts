/**
 * "Add a test for X" — the agent reads an existing function, writes a test
 * for it at a specified path, and runs it to confirm it passes. Exercises
 * read → write → verify (the half of the loop that creates rather than
 * fixes).
 *
 * Sandbox-gated (runs the test). Offline — built-in `assert`, no deps.
 */

import { defineEvalCase } from '../src/index';
import { commandSucceeds, fileExists, turnSucceeded, usedTool } from '../src/scorers';

export default defineEvalCase({
  id: 'add-a-test',
  description: 'Reads a function, writes a runnable test for it, and confirms it passes.',
  requiresSandbox: true,
  systemPrompt:
    'You are a coding assistant working in a sandbox. Read the code before ' +
    'writing a test, and run the test to confirm it passes before finishing.',
  prompt:
    'Add a test at `slugify.test.js` (runnable with `node slugify.test.js`, using ' +
    "Node's built-in `assert` module) that verifies `slugify('Hello World!')` " +
    "returns `'hello-world'`. Run it to confirm it passes.",
  files: {
    'src/slugify.js':
      'function slugify(input) {\n' +
      '  return input\n' +
      '    .toLowerCase()\n' +
      '    .trim()\n' +
      "    .replace(/[^a-z0-9]+/g, '-')\n" +
      "    .replace(/^-+|-+$/g, '');\n" +
      '}\n' +
      'module.exports = { slugify };\n',
  },
  timeoutMs: 180_000,
  scorers: [
    usedTool('sandbox.read_file'), // oriented on the function first
    fileExists('slugify.test.js'), // created the test
    commandSucceeds('node slugify.test.js'), // and it actually passes
    turnSucceeded(),
  ],
});
