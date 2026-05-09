import * as assert from 'node:assert';
import { isHostToWebview, isWebviewToHost } from '../../src/editor/messages';

suite('Contract B — message guards', () => {
  test('isHostToWebview accepts known variants', () => {
    assert.ok(
      isHostToWebview({
        type: 'init',
        apiUrl: 'http://127.0.0.1:5000/flowlib',
        initialPath: '/flowlib/flow/abc',
        theme: 'dark',
      }),
    );
    assert.ok(isHostToWebview({ type: 'themeChanged', theme: 'light' }));
    assert.ok(isHostToWebview({ type: 'navigate', path: '/flowlib/flow/abc/runs' }));
    assert.ok(isHostToWebview({ type: 'flowRunChanged', flowId: 'abc' }));
    assert.ok(isHostToWebview({ type: 'flowDefinitionChanged', flowId: 'abc' }));
  });

  test('isHostToWebview rejects garbage', () => {
    assert.equal(isHostToWebview(null), false);
    assert.equal(isHostToWebview(undefined), false);
    assert.equal(isHostToWebview(42), false);
    assert.equal(isHostToWebview({}), false);
    assert.equal(isHostToWebview({ type: 'unknown' }), false);
    // Webview-bound type — wrong direction.
    assert.equal(isHostToWebview({ type: 'ready' }), false);
  });

  test('isWebviewToHost accepts known variants', () => {
    assert.ok(isWebviewToHost({ type: 'ready' }));
    assert.ok(isWebviewToHost({ type: 'log', level: 'info', msg: 'hi' }));
    assert.ok(isWebviewToHost({ type: 'log', level: 'error', msg: 'boom', data: { x: 1 } }));
  });

  test('isWebviewToHost rejects host-bound shapes', () => {
    assert.equal(
      isWebviewToHost({
        type: 'init',
        apiUrl: 'http://127.0.0.1:5000/flowlib',
        theme: 'dark',
      }),
      false,
    );
    assert.equal(isWebviewToHost({ type: 'navigate', path: '/x' }), false);
    assert.equal(isWebviewToHost('ready'), false);
    assert.equal(isWebviewToHost(null), false);
  });
});
