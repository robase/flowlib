import * as assert from 'node:assert';
import { parseFlowFile } from '../../src/flow-file/parse';

// The TS source IS the canonical definition. The parser evaluates the
// file via @flowlib/sdk/evaluator and returns whatever `defineFlow(...)`
// produced. No JSON footer is read.

const SIMPLE_FLOW = `
import { defineFlow, input, output } from '@flowlib/sdk';
export default defineFlow({
  nodes: [input('x'), output('result')],
  edges: [{ from: 'x', to: 'result' }],
});
`;

const BROKEN_TS = `
import { defineFlow } from '@flowlib/sdk';
export default defineFlow({
  nodes: [{ id: 'n1', // unterminated
});
`;

suite('parseFlowFile — evaluator-only', () => {
  test('parses a well-formed .flow.ts via the evaluator', async () => {
    const result = await parseFlowFile(SIMPLE_FLOW, { trusted: true });
    assert.ok(result.ok, `expected parse success, got: ${(result as { error?: string }).error}`);
    if (result.ok) {
      assert.strictEqual(result.source, 'evaluator');
      assert.ok(result.flow.nodes?.length, 'expected at least one node');
      assert.ok(
        result.flow.nodes?.some((n) => n.referenceId === 'x'),
        'expected an input node with referenceId "x"',
      );
    }
  });

  test('returns ParseFailure on syntactically broken TS', async () => {
    const result = await parseFlowFile(BROKEN_TS, { trusted: true });
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.match(result.error, /evaluation failed/i);
    }
  });

  test('untrusted workspace rejects with a trust-prompt message', async () => {
    const result = await parseFlowFile(SIMPLE_FLOW, { trusted: false });
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.match(result.error, /trust this workspace/i);
    }
  });
});
