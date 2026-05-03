import * as assert from 'node:assert';
import type { ActionMetadata } from '@flowlib/ui/flow-canvas';
import { ActionCatalogue } from '../../src/backend/actionCatalogue';

suite('actionCatalogue — resolver', () => {
  test('snapshot returns the static catalogue when no live override is set', () => {
    const c = new ActionCatalogue();
    const items = c.snapshot();
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0, 'static catalogue must be non-empty');
    // Sentinels — well-known core actions should always be present.
    const types = new Set(items.map((i) => i.type));
    assert.ok(types.has('trigger.manual'), 'expected trigger.manual in catalogue');
    assert.ok(types.has('core.output'), 'expected core.output in catalogue');
  });

  test('every entry has the minimum NodeDefinition shape', () => {
    const c = new ActionCatalogue();
    for (const item of c.snapshot()) {
      assert.equal(typeof item.type, 'string');
      assert.equal(typeof item.label, 'string');
      assert.equal(typeof item.description, 'string');
      assert.ok(Array.isArray(item.outputs));
    }
  });

  test('setLive overrides snapshot; clear restores static', () => {
    const c = new ActionCatalogue();
    const beforeCount = c.snapshot().length;

    const fake: ActionMetadata = {
      type: 'fake.test',
      label: 'fake',
      description: 'live override',
      outputs: [],
    } as unknown as ActionMetadata;
    c.setLive([fake]);
    assert.equal(c.snapshot().length, 1);
    assert.equal(c.snapshot()[0].type, 'fake.test');
    assert.equal(c.isLive(), true);

    c.clear();
    assert.equal(c.snapshot().length, beforeCount);
    assert.equal(c.isLive(), false);
  });
});
