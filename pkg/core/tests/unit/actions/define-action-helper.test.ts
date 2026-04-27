import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import { defineAction } from '@flowlib/action-kit';
import type { ProviderDef } from '@flowlib/action-kit';

const TEST_PROVIDER: ProviderDef = {
  id: 'test',
  name: 'Test',
  icon: 'Box',
  category: 'custom',
  nodeCategory: 'Custom',
};

describe('defineAction — callable helper', () => {
  it('preserves all definition fields for registry consumers', () => {
    const action = defineAction({
      id: 'test.do_thing',
      name: 'Do Thing',
      description: 'Does a thing',
      provider: TEST_PROVIDER,
      params: {
        schema: z.object({ foo: z.string() }),
        fields: [{ name: 'foo', label: 'Foo', type: 'text' }],
      },
      execute: async () => ({ success: true, output: null }),
    });

    expect(action.id).toBe('test.do_thing');
    expect(action.name).toBe('Do Thing');
    expect(action.description).toBe('Does a thing');
    expect(action.provider).toBe(TEST_PROVIDER);
    expect(action.params.fields).toHaveLength(1);
    expect(typeof action.execute).toBe('function');
  });

  it('produces an SdkFlowNode when invoked as a helper', () => {
    const action = defineAction({
      id: 'test.do_thing',
      name: 'Do Thing',
      description: '',
      provider: TEST_PROVIDER,
      params: {
        schema: z.object({ foo: z.string(), count: z.number() }),
        fields: [],
      },
      execute: async () => ({ success: true }),
    });

    const node = action('my_ref', { foo: 'hello', count: 3 });

    expect(node).toEqual({
      referenceId: 'my_ref',
      type: 'test.do_thing',
      params: { foo: 'hello', count: 3 },
    });
  });

  it('threads options through to the node', () => {
    const action = defineAction({
      id: 'test.do_thing',
      name: 'Do Thing',
      description: '',
      provider: TEST_PROVIDER,
      params: { schema: z.object({}), fields: [] },
      execute: async () => ({ success: true }),
    });

    const node = action(
      'my_ref',
      {},
      {
        label: 'Custom Label',
        position: { x: 100, y: 200 },
        id: 'node_custom',
        mapper: { expression: 'items' },
      },
    );

    expect(node.label).toBe('Custom Label');
    expect(node.position).toEqual({ x: 100, y: 200 });
    expect(node.id).toBe('node_custom');
    expect(node.mapper).toEqual({
      enabled: true,
      expression: 'items',
      mode: 'auto',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });
  });

  it('omits optional fields from the node when not provided', () => {
    const action = defineAction({
      id: 'test.do_thing',
      name: 'Do Thing',
      description: '',
      provider: TEST_PROVIDER,
      params: { schema: z.object({}), fields: [] },
      execute: async () => ({ success: true }),
    });

    const node = action('my_ref', {});

    expect(node).not.toHaveProperty('label');
    expect(node).not.toHaveProperty('position');
    expect(node).not.toHaveProperty('id');
    expect(node).not.toHaveProperty('mapper');
  });

  it('preserves a caller-supplied `name` field on the definition (not the function.name)', () => {
    // Regression test: function.name is non-writable by default, so the earlier
    // Object.assign(fn, def) implementation threw in strict mode. Verify the
    // explicit defineProperty pathway keeps the definition's name accessible.
    const action = defineAction({
      id: 'x.y',
      name: 'The Display Name',
      description: '',
      provider: TEST_PROVIDER,
      params: { schema: z.object({}), fields: [] },
      execute: async () => ({ success: true }),
    });

    expect(action.name).toBe('The Display Name');
  });

  it('is still callable via `execute` for the runtime', async () => {
    const action = defineAction({
      id: 'test.do_thing',
      name: 'Do Thing',
      description: '',
      provider: TEST_PROVIDER,
      params: { schema: z.object({ foo: z.string() }), fields: [] },
      execute: async (params) => ({ success: true, output: params.foo.toUpperCase() }),
    });

    const result = await action.execute(
      { foo: 'hi' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { logger: { info() {}, warn() {}, error() {}, debug() {} } as any, credential: null },
    );
    expect(result).toEqual({ success: true, output: 'HI' });
  });
});
