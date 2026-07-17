/**
 * Path confinement for workspace handles.
 *
 * Every `WorkspaceHandle` path argument is ultimately LLM-supplied, so it
 * is untrusted: a `readFile('../../etc/shadow')` or
 * `writeFile('/root/.ssh/authorized_keys', …)` must not escape the
 * workspace root. The tool layer (`ai-sdk/sandbox-tools.ts`) already
 * screens paths, but handles are also driven by the Claude Code /
 * OpenCode providers and the tool-output store — so the confinement lives
 * here too, at the last layer before the path reaches a container.
 *
 * Two shapes, matching the two kinds of backend:
 *
 *   - {@link resolveWorkspacePath} — the root is a known absolute path we
 *     control (local-docker's `workspaceDir`). Absolute inputs are allowed
 *     but must stay under the root; relative inputs are joined onto it.
 *     Mirrors `cloudflare-sandbox/handle.ts`'s `absolute()`.
 *   - {@link assertRelativeWorkspacePath} — the root is provider-defined
 *     and unknown to us (ComputeSDK resolves relative paths against the
 *     sandbox's own cwd). Absolute paths are refused outright, which keeps
 *     access pinned to wherever that cwd is. This matches the documented
 *     tool contract ("Workspace-relative path (e.g. \"src/index.ts\")").
 */

/** Reject NUL — it truncates paths in the C layer below any container runtime. */
function assertNoNullByte(path: string): void {
  if (path.includes('\0')) {
    throw new Error(`Refusing to resolve path with null byte: ${JSON.stringify(path)}`);
  }
}

/** Reject `..` anywhere in the segment list (no normalisation games). */
function assertNoTraversal(segments: string[], original: string): void {
  if (segments.includes('..')) {
    throw new Error(`Path traversal rejected: ${JSON.stringify(original)}`);
  }
}

/**
 * Resolve a workspace path against an absolute `root`, rejecting null
 * bytes, `..` traversal, and absolute paths that fall outside `root`.
 * Returns the absolute in-container path.
 */
export function resolveWorkspacePath(root: string, path: string): string {
  assertNoNullByte(path);
  const base = root.replace(/\/+$/, '');
  // Normalise leading `./` and trailing slashes — but never strip a lone
  // `/` down to `''`, or filesystem root would be waved through as "the
  // workspace root" instead of being rejected as outside it.
  const trimmed = path.replace(/^\.\//, '').replace(/(.)\/+$/, '$1');
  if (trimmed === '' || trimmed === '.') {
    return base;
  }
  const p = trimmed;
  if (p.startsWith('/')) {
    // Caller passed an absolute path — it must remain inside the root.
    assertNoTraversal(p.split('/').filter(Boolean), path);
    if (p !== base && !p.startsWith(`${base}/`)) {
      throw new Error(`Absolute paths must live under ${base}: ${JSON.stringify(path)}`);
    }
    return p;
  }
  const segments = p.split('/').filter(Boolean);
  assertNoTraversal(segments, path);
  return `${base}/${segments.join('/')}`;
}

/**
 * Assert a path is workspace-relative and free of traversal, returning it
 * normalised. For backends whose root is provider-defined: refusing
 * absolute paths is the only way to keep access pinned to the sandbox's
 * own working directory.
 */
export function assertRelativeWorkspacePath(path: string): string {
  assertNoNullByte(path);
  const p = path.replace(/^\.\//, '').replace(/\/+$/, '');
  if (p === '' || p === '.') {
    throw new Error('Refusing to resolve an empty workspace path.');
  }
  if (p.startsWith('/')) {
    throw new Error(`Path must be workspace-relative (no leading "/"): ${JSON.stringify(path)}`);
  }
  const segments = p.split('/').filter(Boolean);
  assertNoTraversal(segments, path);
  return segments.join('/');
}
