/**
 * Tests for the CLAUDE.md / AGENTS.md walker.
 *
 * Uses an in-memory fake `WorkspaceHandle` so tests are pure (no
 * filesystem). The fake's `readFile` throws for missing paths,
 * matching what real implementations do.
 */
import { describe, it, expect } from 'vitest';
import { walkClaudeMd, OutOfRootError, DEFAULT_MAX_BYTES_PER_FILE } from '../claude-md-walk';
import type { WorkspaceHandle } from '../../workspaces/types';

/** Build a fake WorkspaceHandle backed by a `Map<path, content>`. */
function fakeWorkspace(files: Record<string, string>): WorkspaceHandle {
  const fs = new Map(Object.entries(files));
  return {
    id: 'fake',
    rootPath: undefined,
    metadata: {},
    async exec() {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    async readFile(path) {
      const content = fs.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    },
    async writeFile() {},
    async listFiles() {
      return Array.from(fs.keys());
    },
  };
}

describe('walkClaudeMd', () => {
  it('returns empty when no CLAUDE.md or AGENTS.md exist', async () => {
    const handle = fakeWorkspace({ 'src/main.ts': 'foo' });
    const files = await walkClaudeMd(handle, '/ws', '/ws');
    expect(files).toEqual([]);
  });

  it('reads CLAUDE.md at the root', async () => {
    const handle = fakeWorkspace({ 'CLAUDE.md': '# root rules' });
    const files = await walkClaudeMd(handle, '/ws', '/ws');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'CLAUDE.md',
      content: '# root rules',
      truncated: false,
    });
  });

  it('reads both CLAUDE.md and AGENTS.md at the same level', async () => {
    const handle = fakeWorkspace({
      'CLAUDE.md': '# claude',
      'AGENTS.md': '# agents',
    });
    const files = await walkClaudeMd(handle, '/ws', '/ws');
    expect(files.map((f) => f.path)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('walks from a deeply-nested cwd up to rootPath, root-first', async () => {
    const handle = fakeWorkspace({
      'CLAUDE.md': '# root',
      'pkg/CLAUDE.md': '# pkg',
      'pkg/plugins/agents/CLAUDE.md': '# agents',
    });
    const files = await walkClaudeMd(handle, '/ws/pkg/plugins/agents', '/ws');
    expect(files.map((f) => f.path)).toEqual([
      'CLAUDE.md',
      'pkg/CLAUDE.md',
      'pkg/plugins/agents/CLAUDE.md',
    ]);
  });

  it('NEVER walks past rootPath', async () => {
    // Files exist outside the workspace root — the walker must not
    // see them.
    const reads: string[] = [];
    const handle: WorkspaceHandle = {
      id: 'fake',
      metadata: {},
      async exec() {
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      async readFile(path) {
        reads.push(path);
        // Pretend root has a CLAUDE.md so we know the walker reached it.
        if (path === 'CLAUDE.md') {
          return '# root';
        }
        throw new Error(`ENOENT: ${path}`);
      },
      async writeFile() {},
      async listFiles() {
        return [];
      },
    };
    const files = await walkClaudeMd(handle, '/tenants/acme/ws/pkg', '/tenants/acme/ws');
    // Should have attempted reads at exactly two levels: root and pkg.
    // Each level tries CLAUDE.md and AGENTS.md, so 4 attempts total.
    expect(reads).toEqual(['CLAUDE.md', 'AGENTS.md', 'pkg/CLAUDE.md', 'pkg/AGENTS.md']);
    // No reads at any path that would imply walking past root
    // (e.g. `../CLAUDE.md`, `tenants/CLAUDE.md`, `/CLAUDE.md`).
    for (const r of reads) {
      expect(r).not.toContain('..');
      expect(r.startsWith('/')).toBe(false);
      expect(r.startsWith('tenants/')).toBe(false);
    }
    expect(files.map((f) => f.path)).toEqual(['CLAUDE.md']);
  });

  it('throws OutOfRootError when currentDir is outside rootPath', async () => {
    const handle = fakeWorkspace({});
    await expect(walkClaudeMd(handle, '/some/other/path', '/ws')).rejects.toBeInstanceOf(
      OutOfRootError,
    );
  });

  it('throws OutOfRootError for a sibling path that shares a prefix', async () => {
    // `/ws-other` starts with `/ws` lexically but is NOT inside `/ws`.
    const handle = fakeWorkspace({});
    await expect(walkClaudeMd(handle, '/ws-other/sub', '/ws')).rejects.toBeInstanceOf(
      OutOfRootError,
    );
  });

  it('throws OutOfRootError when currentDir contains `..` traversal', async () => {
    const handle = fakeWorkspace({});
    await expect(walkClaudeMd(handle, '/ws/sub/../other', '/ws')).rejects.toBeInstanceOf(
      OutOfRootError,
    );
  });

  it('truncates files larger than maxBytesPerFile', async () => {
    const big = 'a'.repeat(DEFAULT_MAX_BYTES_PER_FILE + 100);
    const handle = fakeWorkspace({ 'CLAUDE.md': big });
    const files = await walkClaudeMd(handle, '/ws', '/ws');
    expect(files).toHaveLength(1);
    expect(files[0].truncated).toBe(true);
    expect(new TextEncoder().encode(files[0].content).byteLength).toBeLessThanOrEqual(
      DEFAULT_MAX_BYTES_PER_FILE,
    );
  });

  it('honours a custom maxBytesPerFile', async () => {
    const handle = fakeWorkspace({ 'CLAUDE.md': 'hello world' });
    const files = await walkClaudeMd(handle, '/ws', '/ws', 5);
    expect(files[0].truncated).toBe(true);
    expect(files[0].content).toBe('hello');
  });

  it('does not split multi-byte UTF-8 chars when truncating', async () => {
    // "💩" is 4 bytes in UTF-8. With a budget of 3 we must produce "".
    const handle = fakeWorkspace({ 'CLAUDE.md': '💩💩' });
    const files = await walkClaudeMd(handle, '/ws', '/ws', 3);
    expect(files[0].truncated).toBe(true);
    // The cut should land on a valid UTF-8 boundary — no replacement chars.
    expect(files[0].content.includes('�')).toBe(false);
  });

  it('handles trailing slashes and `\\` on rootPath / currentDir', async () => {
    const handle = fakeWorkspace({ 'CLAUDE.md': '# root' });
    const files = await walkClaudeMd(handle, '/ws/', '/ws/');
    expect(files).toHaveLength(1);
  });

  it('returns empty when cwd === root and no markdown exists', async () => {
    const handle = fakeWorkspace({});
    const files = await walkClaudeMd(handle, '/ws', '/ws');
    expect(files).toEqual([]);
  });
});
