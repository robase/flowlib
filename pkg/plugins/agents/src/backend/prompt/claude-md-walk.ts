/**
 * `claude-md-walk` — collect `CLAUDE.md` / `AGENTS.md` files from `cwd`
 * up to the workspace root, presented root-first.
 *
 * Mirrors Claude Code's discovery rule but uses `WorkspaceHandle` rather
 * than `node:fs`, so the same code path runs on Cloudflare Sandbox,
 * local-fs, and any future workspace backend.
 *
 * **Boundary rule (non-negotiable).** Walking stops at
 * `workspace.rootPath`. We never walk past it. In multi-workspace
 * deployments (Mode A's `allowedRoot` contains many sibling workspaces),
 * walking up to `allowedRoot` would pick up neighbour-workspace
 * directives or unrelated files in the parent dir. The workspace
 * boundary is the discovery boundary — the same rule that governs
 * Read/Write paths.
 */

import type { WorkspaceHandle } from '../workspaces/types';

/** A discovered CLAUDE.md / AGENTS.md file with workspace-relative path and (possibly truncated) content. */
export interface ClaudeMdFile {
  /** Workspace-relative path (POSIX style, no leading slash). */
  path: string;
  /** UTF-8 content, truncated to `maxBytesPerFile` if needed. */
  content: string;
  /** True iff the file was truncated. */
  truncated: boolean;
}

/** Default per-file truncation budget (bytes). */
export const DEFAULT_MAX_BYTES_PER_FILE = 8 * 1024;

/** Filenames discovered at every level of the walk, in priority order. */
const DISCOVERY_FILENAMES = ['CLAUDE.md', 'AGENTS.md'] as const;

/**
 * Thrown when `currentDir` is not inside `rootPath`. This is a
 * programming error, not a user-facing error — the caller's input
 * validation should have caught it.
 */
export class OutOfRootError extends Error {
  constructor(currentDir: string, rootPath: string) {
    super(
      `[agents] CLAUDE.md walk: currentDir (${currentDir}) is not inside rootPath (${rootPath})`,
    );
    this.name = 'OutOfRootError';
  }
}

/**
 * Normalise a path: collapse `\\` to `/`, strip trailing slashes
 * (except for the root marker), collapse double slashes. Does NOT
 * resolve `..` segments — those are rejected outright (defence in
 * depth against path-traversal sneaking past `startsWith` checks).
 */
function normalisePath(p: string): string {
  const collapsed = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

/**
 * Compute the workspace-relative path: chop `rootPath` off the front of
 * `dir`, strip leading slashes, collapse "" to ".".
 */
function relativeFromRoot(dir: string, rootPath: string): string {
  if (dir === rootPath) return '.';
  const stripped = dir.slice(rootPath.length).replace(/^\/+/, '');
  return stripped === '' ? '.' : stripped;
}

/**
 * Walk `currentDir` up to `rootPath` (inclusive), collecting
 * `CLAUDE.md` / `AGENTS.md` files at each level. Returns root-first so
 * that consumers can render shallower (less specific) directives before
 * deeper ones — letting deeper files override.
 *
 * Each file is read via `handle.readFile` and truncated to
 * `maxBytesPerFile` UTF-8 bytes if longer. Missing files are silently
 * skipped (the workspace handle's `readFile` is allowed to throw any
 * not-found shape — we catch all errors at this layer).
 *
 * @param handle           Workspace handle (Sandbox / local-fs / …).
 * @param currentDir       Absolute starting directory; must be under `rootPath`.
 * @param rootPath         Absolute workspace root; walk stops here.
 * @param maxBytesPerFile  Per-file truncation budget (UTF-8 bytes).
 *                          Default: 8 KB.
 * @throws {OutOfRootError} if `currentDir` is not inside `rootPath`.
 */
export async function walkClaudeMd(
  handle: WorkspaceHandle,
  currentDir: string,
  rootPath: string,
  maxBytesPerFile: number = DEFAULT_MAX_BYTES_PER_FILE,
): Promise<ClaudeMdFile[]> {
  const normRoot = normalisePath(rootPath);
  const normCwd = normalisePath(currentDir);

  // Defence-in-depth: reject any traversal segments before the
  // `startsWith` check below. `..` segments could let an attacker
  // escape via a `readFile('foo/../../etc/passwd')` style trick if we
  // ever fed `dir` back into `readFile`.
  if (normCwd.split('/').some((s) => s === '..')) {
    throw new OutOfRootError(currentDir, rootPath);
  }

  // Both paths normalised: cwd must equal root or be a strict descendant.
  // We require `cwd === root` OR `cwd.startsWith(root + '/')` so a path
  // like `/tmp/wsfoo/...` doesn't accidentally pass when root is `/tmp/ws`.
  const isInside =
    normCwd === normRoot || normCwd.startsWith(normRoot + '/');
  if (!isInside) {
    throw new OutOfRootError(currentDir, rootPath);
  }

  // Walk from cwd UP to root, collecting paths along the way.
  const dirs: string[] = [];
  let dir = normCwd;
  while (dir.length >= normRoot.length) {
    dirs.push(dir);
    if (dir === normRoot) break;
    const lastSlash = dir.lastIndexOf('/');
    // Defensive: if normalisation produced something pathological,
    // bail rather than infinite-loop.
    if (lastSlash <= 0) break;
    dir = dir.slice(0, lastSlash);
  }

  // Reverse so we yield root-first.
  dirs.reverse();

  const results: ClaudeMdFile[] = [];
  for (const d of dirs) {
    const relDir = relativeFromRoot(d, normRoot);
    for (const filename of DISCOVERY_FILENAMES) {
      const relPath = relDir === '.' ? filename : `${relDir}/${filename}`;
      let content: string;
      try {
        content = await handle.readFile(relPath);
      } catch {
        // Missing — skip silently. Both `node:fs` ENOENT and any
        // provider-defined not-found shape end up here.
        continue;
      }
      const { content: truncated, truncated: wasTruncated } = truncateUtf8(
        content,
        maxBytesPerFile,
      );
      results.push({ path: relPath, content: truncated, truncated: wasTruncated });
    }
  }

  return results;
}

/**
 * Truncate a UTF-8 string to at most `maxBytes` bytes without producing
 * an invalid trailing multi-byte sequence. We use `TextEncoder` for the
 * length check (matches what the LLM actually pays for) and walk back
 * from `maxBytes` until we land on a valid char boundary.
 */
function truncateUtf8(
  s: string,
  maxBytes: number,
): { content: string; truncated: boolean } {
  if (maxBytes <= 0) return { content: '', truncated: s.length > 0 };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const bytes = encoder.encode(s);
  if (bytes.byteLength <= maxBytes) {
    return { content: s, truncated: false };
  }
  // Find the largest cut <= maxBytes that doesn't split a multi-byte
  // character. Continuation bytes are 0b10xxxxxx (0x80–0xBF). Walk back
  // past them.
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
    cut--;
  }
  const head = decoder.decode(bytes.subarray(0, cut));
  return { content: head, truncated: true };
}
