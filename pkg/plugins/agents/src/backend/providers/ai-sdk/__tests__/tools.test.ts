import { describe, expect, it } from 'vitest';

import { assembleToolSet, wrapToolsWithOutputStore, type AiSdkToolSet } from '../tools';
import { createToolOutputStore } from '../../../tools/tool-output-store';

/**
 * A tool descriptor whose `execute` returns a fixed value (or throws).
 * `parameters`/`description` are irrelevant to the wrapper, which only
 * touches `execute`.
 */
function fixtureTool(execute: AiSdkToolSet[string]['execute']): AiSdkToolSet[string] {
  return { description: 'fixture', parameters: { type: 'object' }, execute };
}

describe('assembleToolSet', () => {
  const tool = (tag: string): AiSdkToolSet[string] => fixtureTool(async () => ({ from: tag }));

  it('merges stubs < host < injected, with later sources winning collisions', async () => {
    const collisions: string[] = [];
    const set = assembleToolSet({
      stubs: { echo: tool('stub'), shared: tool('stub') },
      host: { read_file: tool('host'), shared: tool('host') },
      injected: { 'skills.read': tool('plugin'), shared: tool('plugin') },
      denied: new Set(),
      allowlist: null,
      onCollision: (n) => collisions.push(n),
    });

    expect(Object.keys(set).sort()).toEqual(['echo', 'read_file', 'shared', 'skills.read']);
    // injected wins the 3-way collision on `shared`.
    expect(await set.shared.execute({}, {})).toEqual({ from: 'plugin' });
    expect(collisions).toContain('shared');
  });

  it('applies the deny set across every source (including injected)', () => {
    const set = assembleToolSet({
      stubs: { echo: tool('stub') },
      host: { read_file: tool('host') },
      injected: { 'skills.read': tool('plugin') },
      denied: new Set(['read_file', 'skills.read']),
      allowlist: null,
    });
    expect(Object.keys(set)).toEqual(['echo']);
  });

  it('honours the allowlist across every source', () => {
    const set = assembleToolSet({
      stubs: { echo: tool('stub') },
      host: { read_file: tool('host') },
      injected: { 'skills.read': tool('plugin') },
      denied: new Set(),
      allowlist: new Set(['skills.read', 'read_file']),
    });
    expect(Object.keys(set).sort()).toEqual(['read_file', 'skills.read']);
  });

  it('works with no injected tools', () => {
    const set = assembleToolSet({
      stubs: { echo: tool('stub') },
      host: {},
      denied: new Set(),
      allowlist: null,
    });
    expect(Object.keys(set)).toEqual(['echo']);
  });
});

describe('wrapToolsWithOutputStore', () => {
  it('passes small structured output through unchanged (no stringify, no footer)', async () => {
    const store = createToolOutputStore();
    const wrapped = wrapToolsWithOutputStore(
      { ping: fixtureTool(async () => ({ ok: true, n: 5 })) },
      store,
    );

    const result = await wrapped.ping.execute({}, { toolCallId: 'tc-small' });

    // Structure is preserved — the wrapper only coerces to string when it
    // has to truncate.
    expect(result).toEqual({ ok: true, n: 5 });
    // Nothing was spilled.
    expect(await store.readFullOutput('tc-small')).toBeUndefined();
  });

  it('truncates a large output and spills the full text to the store', async () => {
    const store = createToolOutputStore(); // default budget: 100 lines / 4 KB
    const big = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
    const wrapped = wrapToolsWithOutputStore({ dump: fixtureTool(async () => big) }, store);

    const result = await wrapped.dump.execute({}, { toolCallId: 'tc-big' });

    expect(typeof result).toBe('string');
    const inline = result as string;
    // Truncated view is shorter than the original and carries the footer.
    expect(inline.length).toBeLessThan(big.length);
    expect(inline).toContain('[output truncated at line 100');
    // The full output is recoverable from the store (workspace-less path).
    expect(await store.readFullOutput('tc-big')).toBe(big);
  });

  it('still truncates when the AI SDK omits toolCallId (fallback id path)', async () => {
    const store = createToolOutputStore();
    const big = Array.from({ length: 250 }, (_, i) => `row ${i}`).join('\n');
    const wrapped = wrapToolsWithOutputStore({ dump: fixtureTool(async () => big) }, store);

    const result = await wrapped.dump.execute({}, {}); // no toolCallId

    expect(typeof result).toBe('string');
    expect(result as string).toContain('[output truncated at line 100');
  });

  it('propagates tool errors (truncation never swallows a failing tool)', async () => {
    const store = createToolOutputStore();
    const wrapped = wrapToolsWithOutputStore(
      {
        boom: fixtureTool(async () => {
          throw new Error('kaboom');
        }),
      },
      store,
    );

    await expect(wrapped.boom.execute({}, { toolCallId: 'tc-err' })).rejects.toThrow('kaboom');
  });

  it('falls back to the raw result if the store itself throws', async () => {
    // A store whose `store()` rejects — the wrapper must still return the
    // tool's raw output rather than failing the tool call.
    const throwingStore = {
      store: async () => {
        throw new Error('store down');
      },
      readFullOutput: async () => undefined,
      readSlice: async () => undefined,
      forget: async () => {},
    };
    const wrapped = wrapToolsWithOutputStore(
      { ping: fixtureTool(async () => ({ ok: true })) },
      throwingStore,
    );

    const result = await wrapped.ping.execute({}, { toolCallId: 'tc-fallback' });
    expect(result).toEqual({ ok: true });
  });
});
