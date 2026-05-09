/**
 * Tool output truncation + overflow store tests.
 *
 * Mocks the `WorkspaceHandle` interface — never touches a real
 * filesystem.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createToolOutputStore,
  DEFAULT_TOOL_OUTPUT_BUDGET,
  stringifyOutput,
} from '../tool-output-store';
import type { WorkspaceHandle } from '../../workspaces/types';

function makeWorkspace(): WorkspaceHandle & {
  writes: Array<{ path: string; content: string }>;
} {
  const writes: Array<{ path: string; content: string }> = [];
  const handle: WorkspaceHandle = {
    id: 'ws_test',
    metadata: {},
    async exec() {
      throw new Error('not used in tool-output-store tests');
    },
    async readFile() {
      throw new Error('not used in tool-output-store tests');
    },
    async writeFile(path, content) {
      writes.push({ path, content });
    },
    async listFiles() {
      return [];
    },
  };
  return Object.assign(handle, { writes });
}

describe('createToolOutputStore', () => {
  it('exposes default budget {100 lines, 4096 bytes}', () => {
    expect(DEFAULT_TOOL_OUTPUT_BUDGET).toEqual({ lines: 100, bytes: 4096 });
  });

  describe('inline path (within budget)', () => {
    it('returns the original output when within budget, no workspace write', async () => {
      const ws = makeWorkspace();
      const store = createToolOutputStore();

      const result = await store.store({
        toolCallId: 'call_1',
        output: 'short response',
        workspace: ws,
      });

      expect(result.truncated).toBe(false);
      expect(result.inline).toBe('short response');
      expect(result.fullOutputRef).toBeUndefined();
      expect(ws.writes).toEqual([]);
    });

    it('JSON-stringifies non-string outputs', async () => {
      const store = createToolOutputStore();
      const result = await store.store({
        toolCallId: 'call_obj',
        output: { foo: 1, bar: 'two' },
      });
      expect(result.truncated).toBe(false);
      expect(JSON.parse(result.inline)).toEqual({ foo: 1, bar: 'two' });
    });

    it('treats null/undefined as empty string', async () => {
      const store = createToolOutputStore();
      const result = await store.store({ toolCallId: 'call_nil', output: null });
      expect(result.inline).toBe('');
      expect(result.truncated).toBe(false);
    });
  });

  describe('workspace-attached overflow', () => {
    it('truncates by line count and writes the full output to .flowlib/tool-outputs/', async () => {
      const ws = makeWorkspace();
      const store = createToolOutputStore({
        budget: { lines: 5, bytes: 10_000 },
      });

      const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
      const fullOutput = lines.join('\n');

      const result = await store.store({
        toolCallId: 'call_lines',
        output: fullOutput,
        workspace: ws,
      });

      expect(result.truncated).toBe(true);
      expect(result.totalLines).toBe(20);
      expect(result.fullOutputRef).toBe('.flowlib/tool-outputs/call_lines.txt');
      expect(ws.writes).toHaveLength(1);
      expect(ws.writes[0]).toEqual({
        path: '.flowlib/tool-outputs/call_lines.txt',
        content: fullOutput,
      });

      // First five lines preserved.
      expect(result.inline).toContain('line-1');
      expect(result.inline).toContain('line-5');
      expect(result.inline).not.toContain('line-6');
      // Footer mentions the file path + the agent-recovery hint.
      expect(result.inline).toContain('[output truncated at line 5');
      expect(result.inline).toContain('.flowlib/tool-outputs/call_lines.txt');
      expect(result.inline).toContain('Grep / Read');
    });

    it('truncates by byte budget when output is a single long line', async () => {
      const ws = makeWorkspace();
      const store = createToolOutputStore({ budget: { lines: 1000, bytes: 32 } });

      const fullOutput = 'a'.repeat(500);

      const result = await store.store({
        toolCallId: 'call_bytes',
        output: fullOutput,
        workspace: ws,
      });

      expect(result.truncated).toBe(true);
      const head = result.inline.split('\n')[0];
      expect(head.length).toBeLessThanOrEqual(32);
      expect(head.length).toBeGreaterThan(0);
      expect(ws.writes[0].content).toHaveLength(500);
    });

    it('honours per-call budget overrides', async () => {
      const ws = makeWorkspace();
      const store = createToolOutputStore({
        budget: { lines: 1000, bytes: 1_000_000 },
      });

      const result = await store.store({
        toolCallId: 'call_override',
        output: 'one\ntwo\nthree\nfour\nfive',
        budget: { lines: 2 },
        workspace: ws,
      });

      expect(result.truncated).toBe(true);
      expect(result.inline).toContain('one');
      expect(result.inline).toContain('two');
      expect(result.inline).not.toContain('three');
    });

    it('falls back to in-memory storage on workspace.writeFile failure', async () => {
      const ws = makeWorkspace();
      const writeFile = vi
        .spyOn(ws, 'writeFile')
        .mockRejectedValueOnce(new Error('disk full'));

      const warn = vi.fn();
      const store = createToolOutputStore({
        budget: { lines: 2, bytes: 10_000 },
        logger: { warn },
      });

      const result = await store.store({
        toolCallId: 'call_write_fail',
        output: 'a\nb\nc\nd\ne',
        workspace: ws,
      });

      expect(result.truncated).toBe(true);
      // ref keeps the toolCallId so read_tool_output still works.
      expect(result.fullOutputRef).toBe('call_write_fail');
      expect(result.inline).toContain('workspace write failed');
      expect(result.inline).toContain('session storage fallback');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('workspace.writeFile failed'),
      );
      expect(writeFile).toHaveBeenCalledTimes(1);

      // The full output is now retrievable from the in-memory map.
      const fetched = await store.readFullOutput('call_write_fail');
      expect(fetched).toBe('a\nb\nc\nd\ne');
    });

    it('sanitizes hostile tool-call ids when building the workspace path', async () => {
      const ws = makeWorkspace();
      const store = createToolOutputStore({ budget: { lines: 1, bytes: 1 } });

      await store.store({
        toolCallId: '../../../etc/passwd',
        output: 'aaaa\nbbbb\ncccc',
        workspace: ws,
      });

      expect(ws.writes).toHaveLength(1);
      // Path stays inside the configured subdir — no extra `/` slashes
      // (which would imply real directory traversal). `..` characters
      // are fine because filenames allow `.`; what we care about is
      // that the file is rooted in the subdir.
      const path = ws.writes[0].path;
      expect(path.startsWith('.flowlib/tool-outputs/')).toBe(true);
      const filename = path.slice('.flowlib/tool-outputs/'.length);
      expect(filename).not.toContain('/');
      expect(filename).toMatch(/^[A-Za-z0-9._-]+\.txt$/);
    });

    it('respects a custom subdir', async () => {
      const ws = makeWorkspace();
      const store = createToolOutputStore({
        subdir: '.flowlib/sessions/abc/outputs',
        budget: { lines: 1, bytes: 1 },
      });

      await store.store({
        toolCallId: 'call_subdir',
        output: 'aa\nbb\ncc',
        workspace: ws,
      });

      expect(ws.writes[0].path).toBe(
        '.flowlib/sessions/abc/outputs/call_subdir.txt',
      );
    });
  });

  describe('workspace-less overflow (in-memory)', () => {
    it('stores overflowed full output in the in-memory map', async () => {
      const store = createToolOutputStore({ budget: { lines: 2, bytes: 10_000 } });
      const big = 'one\ntwo\nthree\nfour\nfive';

      const result = await store.store({ toolCallId: 'rl_1', output: big });

      expect(result.truncated).toBe(true);
      expect(result.fullOutputRef).toBe('rl_1');
      expect(result.inline).toContain('stored in session');
      expect(result.inline).toContain('read_tool_output');

      const fetched = await store.readFullOutput('rl_1');
      expect(fetched).toBe(big);
    });

    it('readSlice supports offset/limit/grep on a stored output', async () => {
      const store = createToolOutputStore({ budget: { lines: 2, bytes: 10_000 } });
      await store.store({
        toolCallId: 'rl_slice',
        output: ['alpha', 'bravo', 'alpha-2', 'charlie', 'delta'].join('\n'),
      });

      const fetched = await store.readSlice('rl_slice', { offset: 1, limit: 2 });
      expect(fetched).toBe('bravo\nalpha-2');

      const grepped = await store.readSlice('rl_slice', { grep: 'alpha' });
      expect(grepped).toBe('alpha\nalpha-2');
    });

    it('readFullOutput / readSlice return undefined for unknown ids', async () => {
      const store = createToolOutputStore();
      expect(await store.readFullOutput('nope')).toBeUndefined();
      expect(await store.readSlice('nope')).toBeUndefined();
    });

    it('forget removes a stored output (idempotent)', async () => {
      const store = createToolOutputStore({ budget: { lines: 1, bytes: 1 } });
      await store.store({ toolCallId: 'rl_forget', output: 'a\nb\nc' });
      expect(await store.readFullOutput('rl_forget')).toBe('a\nb\nc');

      await store.forget('rl_forget');
      expect(await store.readFullOutput('rl_forget')).toBeUndefined();

      // Idempotent.
      await expect(store.forget('rl_forget')).resolves.toBeUndefined();
    });
  });

  describe('stringifyOutput', () => {
    it('round-trips strings, JSONs objects, returns "" for nullish', () => {
      expect(stringifyOutput('hello')).toBe('hello');
      expect(stringifyOutput(null)).toBe('');
      expect(stringifyOutput(undefined)).toBe('');
      expect(JSON.parse(stringifyOutput({ a: 1 }))).toEqual({ a: 1 });
    });
  });
});
