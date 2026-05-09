import * as assert from 'node:assert';
import { isHostToWebview, isWebviewToHost } from '../../src/editor/messages';

suite('Contract B — message guards', () => {
  test('isHostToWebview accepts known variants', () => {
    assert.ok(
      isHostToWebview({
        type: 'init',
        flow: { nodes: [], edges: [] },
        actions: [],
        readonly: false,
        theme: 'dark',
      }),
    );
    assert.ok(isHostToWebview({ type: 'update', flow: { nodes: [], edges: [] } }));
    assert.ok(isHostToWebview({ type: 'themeChanged', theme: 'light' }));
  });

  test('isHostToWebview rejects garbage', () => {
    assert.equal(isHostToWebview(null), false);
    assert.equal(isHostToWebview(undefined), false);
    assert.equal(isHostToWebview(42), false);
    assert.equal(isHostToWebview({}), false);
    assert.equal(isHostToWebview({ type: 'unknown' }), false);
    assert.equal(isHostToWebview({ type: 'edit', flow: {} }), false); // wrong direction
  });

  test('isWebviewToHost accepts known variants', () => {
    assert.ok(isWebviewToHost({ type: 'ready' }));
    assert.ok(isWebviewToHost({ type: 'edit', flow: { nodes: [], edges: [] } }));
    assert.ok(isWebviewToHost({ type: 'requestRun', inputs: {} }));
    assert.ok(isWebviewToHost({ type: 'log', level: 'info', msg: 'hi' }));
  });

  test('isWebviewToHost rejects host-bound shapes', () => {
    assert.equal(
      isWebviewToHost({ type: 'init', flow: {}, actions: [], readonly: false, theme: 'dark' }),
      false,
    );
    assert.equal(isWebviewToHost('ready'), false);
  });
});
