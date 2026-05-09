import * as assert from 'node:assert';
import { isValidBackendUrl, readConfig } from '../../src/util/config';

suite('config — defaults + URL validation', () => {
  test('readConfig returns defaults when no overrides present', () => {
    const c = readConfig();
    assert.equal(typeof c.backendUrl, 'string');
    assert.equal(typeof c.autoSaveDebounceMs, 'number');
    assert.equal(typeof c.diagnosticsEnabled, 'boolean');
    assert.equal(typeof c.formatOnSave, 'boolean');
  });

  test('isValidBackendUrl rejects empty / malformed / non-http', () => {
    assert.deepEqual(isValidBackendUrl(''), { ok: false, reason: 'empty' });
    assert.deepEqual(isValidBackendUrl('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(isValidBackendUrl('not a url'), { ok: false, reason: 'malformed URL' });
    assert.deepEqual(isValidBackendUrl('file:///tmp/x'), {
      ok: false,
      reason: 'unsupported protocol: file:',
    });
    assert.deepEqual(isValidBackendUrl('javascript:alert(1)'), {
      ok: false,
      reason: 'unsupported protocol: javascript:',
    });
    assert.deepEqual(isValidBackendUrl('vscode://settings'), {
      ok: false,
      reason: 'unsupported protocol: vscode:',
    });
  });

  test('isValidBackendUrl accepts http and https', () => {
    assert.deepEqual(isValidBackendUrl('http://localhost:3000/flowlib'), { ok: true });
    assert.deepEqual(isValidBackendUrl('https://flowlib.example.com'), { ok: true });
    assert.deepEqual(isValidBackendUrl('http://192.168.1.5:8080/'), { ok: true });
  });
});
