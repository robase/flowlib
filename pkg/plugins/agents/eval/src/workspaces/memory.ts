/**
 * `InMemoryWorkspace` — a `WorkspaceHandle` backed by a `Map`, for
 * lightweight prompt/tool-selection evals that don't need a real shell.
 *
 * Use this for cases that score on tool *selection*, file *writes*, and
 * final text. For cases that need to actually run tests/typecheck (the
 * verification loop), wire the real `local-docker` workspace provider
 * instead — its handle implements the same interface.
 */

import type { WorkspaceExecResult, WorkspaceHandle } from '../../../src/backend/workspaces/types';

/** Simple glob → RegExp supporting `**`, `*`, and `?`. */
function globToRegExp(glob: string): RegExp {
  // Single pass: `**` is listed first so it wins over `*`, which avoids needing a
  // placeholder sentinel between passes. Anything else in the class is a regex
  // metacharacter and gets escaped.
  const pattern = glob.replace(/\*\*|\*|\?|[.+^${}()|[\]\\]/g, (token) => {
    switch (token) {
      case '**':
        return '.*';
      case '*':
        return '[^/]*';
      case '?':
        return '[^/]';
      default:
        return `\\${token}`;
    }
  });
  return new RegExp(`^${pattern}$`);
}

export class InMemoryWorkspace implements WorkspaceHandle {
  readonly id: string;
  readonly metadata: Record<string, unknown> = {};
  private files = new Map<string, string>();

  constructor(id = 'eval-workspace', seed?: Record<string, string>) {
    this.id = id;
    if (seed) {
      for (const [path, content] of Object.entries(seed)) {
        this.files.set(normalise(path), content);
      }
    }
  }

  /**
   * In-memory has no shell. Returns a non-zero exit rather than throwing
   * so a misbehaving agent that shells out degrades gracefully — cases
   * that need real `exec` should use the docker workspace.
   */
  async exec(command: string): Promise<WorkspaceExecResult> {
    return {
      stdout: '',
      stderr: `InMemoryWorkspace cannot exec: ${command}`,
      exitCode: 127,
    };
  }

  async readFile(path: string): Promise<string> {
    const key = normalise(path);
    const content = this.files.get(key);
    if (content === undefined) {
      throw new Error(`InMemoryWorkspace: no such file "${key}"`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(normalise(path), content);
  }

  async listFiles(glob: string): Promise<string[]> {
    const re = globToRegExp(normalise(glob));
    return [...this.files.keys()].filter((p) => re.test(p)).sort();
  }

  // ─── Eval-only helpers (not part of WorkspaceHandle) ────────────────

  /** True if the file exists. */
  has(path: string): boolean {
    return this.files.has(normalise(path));
  }

  /** Read without throwing; `undefined` if absent. */
  peek(path: string): string | undefined {
    return this.files.get(normalise(path));
  }

  /** Snapshot of all paths currently present. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}

function normalise(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '');
}
