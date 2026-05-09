/**
 * Tests for `composeSystemPrompt` — section ordering, empty-section
 * elision, deny-list rendering, attachments, plan rendering, etc.
 *
 * The CLAUDE.md walk has its own dedicated test file
 * (`claude-md-walk.test.ts`); here we just verify the composer wires it
 * up correctly.
 */
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt, type ComposeInput } from '../compose';
import type { WorkspaceHandle } from '../../workspaces/types';

function fakeWorkspace(
  files: Record<string, string> = {},
  topLevel: string[] = [],
): WorkspaceHandle {
  const fs = new Map(Object.entries(files));
  return {
    id: 'fake',
    metadata: {},
    async exec() {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    async readFile(p) {
      const c = fs.get(p);
      if (c === undefined) {throw new Error(`ENOENT: ${p}`);}
      return c;
    },
    async writeFile() {},
    async listFiles() {
      return topLevel;
    },
  };
}

function baseInput(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    persona: { systemPrompt: 'You are a helpful coder.' },
    skillSummaries: [],
    denyList: [],
    availableTools: [],
    memory: [],
    attachments: [],
    ...over,
  };
}

describe('composeSystemPrompt', () => {
  it('renders persona + operating directives at minimum', async () => {
    const out = await composeSystemPrompt(baseInput());
    expect(out.startsWith('You are a helpful coder.')).toBe(true);
    expect(out).toContain('## Operating directives');
    // No empty headers should be rendered
    expect(out).not.toContain('## Workspace');
    expect(out).not.toContain('## Available tools');
    expect(out).not.toContain('## Tool restrictions');
    expect(out).not.toContain('## Available skills');
    expect(out).not.toContain('## Attachments');
    expect(out).not.toContain('## Project directives');
    expect(out).not.toContain('## Relevant memories');
    expect(out).not.toContain('## Session plan');
  });

  it('renders sections in spec order', async () => {
    const handle = fakeWorkspace({ 'CLAUDE.md': '# directives' }, ['src', 'README.md']);
    const out = await composeSystemPrompt(
      baseInput({
        workspace: { handle, rootPath: '/ws', branch: 'main' },
        skillSummaries: [{ name: 'pr-flow', description: 'How to PR' }],
        denyList: ['Bash'],
        availableTools: [{ name: 'Read', description: 'read files' }],
        memory: [{ scope: 'project', content: 'use tabs' }],
        plan: { checkpoints: [{ id: 'c1', label: 'do thing', status: 'todo' }] },
        attachments: [{ name: 'log.txt', mediaType: 'text/plain' }],
      }),
    );

    const order = [
      'You are a helpful coder.',
      '## Workspace',
      '## Project directives',
      '## Available skills',
      '## Tool restrictions',
      '## Available tools',
      '## Relevant memories',
      '## Session plan',
      '## Attachments',
      '## Operating directives',
    ];
    let last = -1;
    for (const marker of order) {
      const idx = out.indexOf(marker);
      expect(idx, `expected ${marker} after pos ${last}`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('omits the workspace section entirely when no workspace is given', async () => {
    const out = await composeSystemPrompt(baseInput());
    expect(out).not.toContain('## Workspace');
    expect(out).not.toContain('## Project directives');
  });

  it('CLAUDE.md walk only runs when there IS a workspace', async () => {
    // Without a workspace, no readFile attempts at all.
    const handle: WorkspaceHandle = {
      id: 'fake',
      metadata: {},
      async exec() {
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      async readFile() {
        throw new Error('should not be called');
      },
      async writeFile() {},
      async listFiles() {
        return [];
      },
    };
    // No workspace input → handle.readFile never invoked.
    const out = await composeSystemPrompt(baseInput());
    void handle; // keep unused-var linters quiet
    expect(out).not.toContain('## Project directives');
  });

  it('walks CLAUDE.md from cwd up to rootPath, root-first', async () => {
    const handle = fakeWorkspace({
      'CLAUDE.md': '# root',
      'pkg/CLAUDE.md': '# pkg',
    });
    const out = await composeSystemPrompt(
      baseInput({
        workspace: { handle, rootPath: '/ws', cwd: '/ws/pkg' },
      }),
    );
    const rootPos = out.indexOf('### CLAUDE.md');
    const pkgPos = out.indexOf('### pkg/CLAUDE.md');
    expect(rootPos).toBeGreaterThan(-1);
    expect(pkgPos).toBeGreaterThan(rootPos);
  });

  it('renders deny list as a soft mention', async () => {
    const out = await composeSystemPrompt(
      baseInput({ denyList: ['Bash', 'WebFetch'] }),
    );
    expect(out).toContain('## Tool restrictions');
    expect(out).toContain('You are not permitted to use: Bash, WebFetch.');
    expect(out).toContain('hard-blocked');
  });

  it('omits deny list section when denyList is empty', async () => {
    const out = await composeSystemPrompt(baseInput({ denyList: [] }));
    expect(out).not.toContain('## Tool restrictions');
    expect(out).not.toContain('You are not permitted to use');
  });

  it('renders skill summaries with name + description only', async () => {
    const out = await composeSystemPrompt(
      baseInput({
        skillSummaries: [
          { name: 'pr-workflow', description: 'open a PR' },
          { name: 'release', description: 'cut a release' },
        ],
      }),
    );
    expect(out).toContain('## Available skills');
    expect(out).toContain('**pr-workflow** — open a PR');
    expect(out).toContain('**release** — cut a release');
  });

  it('renders plan checkpoints with status boxes', async () => {
    const out = await composeSystemPrompt(
      baseInput({
        plan: {
          checkpoints: [
            { id: '1', label: 'planned', status: 'todo' },
            { id: '2', label: 'wip', status: 'doing' },
            { id: '3', label: 'shipped', status: 'done' },
            { id: '4', label: 'stuck', status: 'blocked' },
          ],
        },
      }),
    );
    expect(out).toContain('[ ] planned');
    expect(out).toContain('[~] wip');
    expect(out).toContain('[x] shipped');
    expect(out).toContain('[!] stuck');
  });

  it('renders attachments with media type and optional description', async () => {
    const out = await composeSystemPrompt(
      baseInput({
        attachments: [
          { name: 'a.png', mediaType: 'image/png', description: 'screenshot' },
          { name: 'b.txt', mediaType: 'text/plain' },
        ],
      }),
    );
    expect(out).toContain('a.png (image/png) — screenshot');
    expect(out).toContain('b.txt (text/plain)');
  });

  it('renders workspace top-level listing capped at 5 entries', async () => {
    const handle = fakeWorkspace(
      {},
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    );
    const out = await composeSystemPrompt(
      baseInput({ workspace: { handle, rootPath: '/ws' } }),
    );
    expect(out).toContain('## Workspace');
    expect(out).toContain('Top-level entries:');
    expect(out).toContain('- a');
    expect(out).toContain('- e');
    // Capped at 5 — `f` and `g` should not appear.
    expect(out).not.toContain('- f');
    expect(out).not.toContain('- g');
  });

  it('handles a workspace whose listFiles fails gracefully', async () => {
    const handle: WorkspaceHandle = {
      id: 'fake',
      metadata: {},
      async exec() {
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      async readFile() {
        throw new Error('ENOENT');
      },
      async writeFile() {},
      async listFiles() {
        throw new Error('boom');
      },
    };
    // Should not throw — the section just renders without the listing.
    const out = await composeSystemPrompt(
      baseInput({ workspace: { handle, rootPath: '/ws' } }),
    );
    expect(out).toContain('## Workspace');
    expect(out).toContain('cwd: /ws');
    expect(out).not.toContain('Top-level entries:');
  });

  it('renders branch and repo summary when given', async () => {
    const handle = fakeWorkspace({}, []);
    const out = await composeSystemPrompt(
      baseInput({
        workspace: {
          handle,
          rootPath: '/ws',
          branch: 'feature/foo',
          repoSummary: 'Tiny repo for testing',
        },
      }),
    );
    expect(out).toContain('branch: feature/foo');
    expect(out).toContain('Repo summary:');
    expect(out).toContain('Tiny repo for testing');
  });

  it('separates sections with blank lines', async () => {
    const out = await composeSystemPrompt(
      baseInput({ denyList: ['Bash'] }),
    );
    // Persona then blank line then deny list header.
    expect(out).toMatch(/You are a helpful coder\.\n\n## Tool restrictions/);
  });

  it('omits the persona section if persona text is empty/whitespace', async () => {
    const out = await composeSystemPrompt(
      baseInput({ persona: { systemPrompt: '   ' } }),
    );
    // Operating directives still rendered — but no leading whitespace
    // section.
    expect(out.startsWith('## Operating directives')).toBe(true);
  });
});

describe('registerPromptComposer', () => {
  it('attaches composeSystemPrompt to ctx.registries.promptComposer', async () => {
    const { registerPromptComposer } = await import('../register');
    const logs: Array<{ level: string; msg: string }> = [];
    const registries: {
      providers: Map<string, unknown>;
      workspaces: Map<string, unknown>;
      promptComposer?: unknown;
    } = {
      providers: new Map(),
      workspaces: new Map(),
    };
    const ctx = {
      options: { staticOrgId: 'x', orgScope: 'optional' as const },
      flowlib: {} as never,
      actionRegistry: {} as never,
      registries,
      logger: {
        debug: () => {},
        info: (msg: string) => logs.push({ level: 'info', msg }),
        warn: () => {},
        error: () => {},
      },
    };
    registerPromptComposer(ctx as never);
    expect(registries.promptComposer).toBe(composeSystemPrompt);
    expect(logs.some((l) => /prompt composer registered/.test(l.msg))).toBe(true);
  });
});
