/**
 * Gather session-start "orienting" context from an eagerly-provisioned
 * workspace — the environment + git status blocks Claude Code injects so
 * the agent knows where it is, what branch, and recent history before it
 * acts.
 *
 * This needs a live workspace (a booted sandbox container), so it only
 * runs for sessions provisioned eagerly (see the `eagerWorkspace` path in
 * `chat-session-host.ts`). Lazy / pure-chat sessions have no container at
 * compose time and skip this entirely.
 *
 * Everything is **best-effort**: a single combined `exec` reads cwd,
 * platform, and git facts in one round-trip (each `exec` is a budgeted
 * sandbox RPC). A non-git workspace, a missing `git`, or an `exec` failure
 * degrades gracefully — we still return the environment block with what we
 * have, just without git details. The result is a session-start snapshot
 * (memoised with the prompt); it does not track mid-session branch/commit
 * changes, which is the same contract Claude Code's context has.
 */

import type { WorkspaceHandle } from '../workspaces/types';
import type { EnvironmentInput, GitStatusInput } from './sections';

export interface CodeContext {
  environment: EnvironmentInput;
  gitStatus?: GitStatusInput;
}

export interface GatherOptions {
  /** Model id driving the session (shown in the environment block). */
  model?: string;
  /** Override "today" (tests). Defaults to the current UTC date. */
  today?: string;
  /** exec timeout for the combined gather command. */
  timeoutMs?: number;
}

/** Marker prefix for the delimited sections of the gather script's output. */
const MARK = '@@FL:';

/**
 * One shell script that emits each fact under a sentinel marker, so a
 * single `exec` collects everything. Every git command is `2>/dev/null`
 * so a non-repo just yields empty sections rather than noise.
 */
const GATHER_SCRIPT = [
  `echo "${MARK}CWD@@"; pwd 2>/dev/null`,
  `echo "${MARK}UNAME@@"; uname -sm 2>/dev/null`,
  `echo "${MARK}ISGIT@@"; git rev-parse --is-inside-work-tree 2>/dev/null`,
  `echo "${MARK}BRANCH@@"; git branch --show-current 2>/dev/null`,
  `echo "${MARK}MAIN@@"; git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s@^origin/@@"`,
  `echo "${MARK}USER@@"; printf "%s <%s>" "$(git config user.name 2>/dev/null)" "$(git config user.email 2>/dev/null)"; echo`,
  `echo "${MARK}STATUS@@"; git status --short 2>/dev/null | head -n 40`,
  `echo "${MARK}LOG@@"; git log --oneline -n 5 2>/dev/null`,
  `echo "${MARK}END@@"`,
].join('\n');

const GATHER_TIMEOUT_MS = 10_000;

/**
 * Parse the delimited gather output into a `{ SECTION: text }` map. Lines
 * before the first marker are ignored; each marker opens a bucket that
 * collects subsequent lines until the next marker.
 */
function parseSections(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current) {
      // Strip leading blank lines + trailing whitespace, but preserve the
      // first content line's leading spaces — git's `--short` porcelain uses
      // a leading space to distinguish staged vs unstaged.
      out[current] = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    }
    buf = [];
  };
  for (const line of output.split('\n')) {
    const m = line.match(/^@@FL:(\w+)@@$/);
    if (m) {
      flush();
      current = m[1] ?? null;
      continue;
    }
    if (current) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * Gather the environment + git-status context from a live workspace.
 * Never throws — on any failure it returns a minimal environment block.
 */
export async function gatherCodeContext(
  handle: WorkspaceHandle,
  options: GatherOptions = {},
): Promise<CodeContext> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const fallbackCwd = handle.rootPath ?? '/workspace';
  const baseEnv: EnvironmentInput = {
    cwd: fallbackCwd,
    today,
    ...(options.model ? { model: options.model } : {}),
  };

  try {
    const res = await handle.exec(GATHER_SCRIPT, {
      timeoutMs: options.timeoutMs ?? GATHER_TIMEOUT_MS,
    });
    const s = parseSections(res.stdout ?? '');

    const cwd = s.CWD?.trim() || fallbackCwd;
    const platform = s.UNAME?.trim() || undefined;
    const isGitRepo = s.ISGIT?.trim() === 'true';

    const environment: EnvironmentInput = {
      cwd,
      isGitRepo,
      today,
      ...(platform ? { platform } : {}),
      ...(options.model ? { model: options.model } : {}),
    };

    if (!isGitRepo) {
      return { environment };
    }

    const userRaw = s.USER?.trim();
    const user = userRaw && userRaw !== '<>' ? userRaw : undefined;
    const gitStatus: GitStatusInput = {
      ...(s.BRANCH?.trim() ? { branch: s.BRANCH.trim() } : {}),
      ...(s.MAIN?.trim() ? { mainBranch: s.MAIN.trim() } : {}),
      ...(user ? { user } : {}),
      // Preserve porcelain leading spaces (already trailing-trimmed by the parser).
      ...(s.STATUS?.trim() ? { status: s.STATUS } : {}),
      ...(s.LOG?.trim() ? { recentCommits: s.LOG.trim() } : {}),
    };
    return { environment, gitStatus };
  } catch {
    return { environment: baseEnv };
  }
}

export { GATHER_SCRIPT };
