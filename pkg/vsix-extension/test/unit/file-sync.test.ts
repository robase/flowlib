/**
 * Unit tests for `FileSync.hash` — the canonical hashing primitive
 * that drives loop-prevention.
 *
 * Both directions of the file ↔ DB sync compare hashes to decide
 * whether an incoming write is the echo of one they just performed.
 * If the hash isn't stable across structurally-equivalent objects,
 * suppression breaks: an echoed write looks "different" and gets
 * propagated, which sets up an infinite loop.
 *
 * These are pure tests — they avoid the `vscode` import surface so
 * they can run outside VSCode (just `mocha`). The dependencies passed
 * into `FileSync` are stubbed.
 */

import * as assert from 'node:assert';
import { FileSync } from '../../src/backend/file-sync';

function makeSync(): FileSync {
  return new FileSync({
    getFileUriForFlow: () => undefined,
    ensureFlowForFile: () => Promise.resolve('test-flow-id'),
    pushVersion: () => Promise.resolve(),
  });
}

suite('FileSync.hash — canonical hashing', () => {
  test('identical definitions hash identically', () => {
    const sync = makeSync();
    const a = { nodes: [{ id: 'n1', type: 'trigger.manual' }], edges: [] };
    const b = { nodes: [{ id: 'n1', type: 'trigger.manual' }], edges: [] };
    assert.strictEqual(sync.hash(a), sync.hash(b));
  });

  test('different key order produces the same hash (canonical = sorted)', () => {
    const sync = makeSync();
    const a = { nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'x' }], edges: [] };
    const b = { edges: [], nodes: [{ referenceId: 'x', type: 'trigger.manual', id: 'n1' }] };
    assert.strictEqual(sync.hash(a), sync.hash(b));
  });

  test('changing a value changes the hash', () => {
    const sync = makeSync();
    const a = { nodes: [{ id: 'n1', type: 'trigger.manual' }], edges: [] };
    const b = { nodes: [{ id: 'n1', type: 'core.output' }], edges: [] };
    assert.notStrictEqual(sync.hash(a), sync.hash(b));
  });

  test('adding a node changes the hash', () => {
    const sync = makeSync();
    const a = { nodes: [{ id: 'n1' }], edges: [] };
    const b = { nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [] };
    assert.notStrictEqual(sync.hash(a), sync.hash(b));
  });

  test('nested object key order also normalised', () => {
    const sync = makeSync();
    const a = { nodes: [{ id: 'n1', params: { a: 1, b: 2 } }], edges: [] };
    const b = { nodes: [{ id: 'n1', params: { b: 2, a: 1 } }], edges: [] };
    assert.strictEqual(sync.hash(a), sync.hash(b));
  });

  test('null vs undefined treated distinctly', () => {
    const sync = makeSync();
    const a = { nodes: [{ id: 'n1', x: null }], edges: [] };
    const b = { nodes: [{ id: 'n1', x: undefined }], edges: [] };
    // JSON.stringify drops `undefined` properties — they hash differently
    // from `null`. This matches the canvas's behaviour: omitted keys
    // and explicit-null keys aren't treated as the same definition.
    assert.notStrictEqual(sync.hash(a), sync.hash(b));
  });
});
