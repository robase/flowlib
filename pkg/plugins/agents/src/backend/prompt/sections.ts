/**
 * Section builders for the system-prompt composer.
 *
 * One pure function per section. Each returns either a non-empty string
 * (with its own header) or `null` (skip the section entirely — no
 * header, no whitespace). The composer joins non-null sections with
 * blank lines.
 *
 * The shape of each builder's input is intentionally narrow: builders
 * see only the data they need, not the full `ComposeInput`. That keeps
 * them trivially testable and makes section ordering changes a one-line
 * edit in `compose.ts`.
 */

import type { WorkspaceHandle } from '../workspaces/types';
import type { ClaudeMdFile } from './claude-md-walk';

// ─── System prompt ─────────────────────────────────────────────────────

/**
 * Render the user-supplied system prompt. The system prompt is the
 * first thing the model sees, so we don't add a `## …` header — the
 * text itself opens the prompt. Empty prompt returns `null` so the
 * composer skips the section entirely.
 */
export function renderSystemPrompt(systemPrompt: string | null | undefined): string | null {
  const trimmed = (systemPrompt ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Workspace context ────────────────────────────────────────────────

export interface WorkspaceContextInput {
  handle: WorkspaceHandle;
  rootPath: string;
  repoSummary?: string;
  branch?: string;
}

/**
 * Render workspace metadata: cwd, branch, top-level dir listing, and a
 * one-paragraph repo summary if one was provided. Skipped entirely
 * (returns `null`) when the session has no workspace.
 *
 * The top-level listing is best-effort — if `listFiles` fails or
 * returns nothing, we still render the section with the other fields.
 */
export async function renderWorkspaceContext(
  input: WorkspaceContextInput | undefined,
): Promise<string | null> {
  if (!input) {
    return null;
  }

  const lines: string[] = ['## Workspace', `cwd: ${input.rootPath}`];
  if (input.branch) {
    lines.push(`branch: ${input.branch}`);
  }

  const topLevel = await listTopLevel(input.handle);
  if (topLevel.length > 0) {
    lines.push('');
    lines.push('Top-level entries:');
    for (const entry of topLevel) {
      lines.push(`- ${entry}`);
    }
  }

  if (input.repoSummary && input.repoSummary.trim() !== '') {
    lines.push('');
    lines.push('Repo summary:');
    lines.push(input.repoSummary.trim());
  }

  return lines.join('\n');
}

/**
 * Best-effort top-level listing. Caps at 5 entries (per spec). Many
 * `WorkspaceHandle` implementations require an explicit glob — we try
 * `*` first and fall back gracefully on errors.
 */
async function listTopLevel(handle: WorkspaceHandle): Promise<string[]> {
  try {
    const entries = await handle.listFiles('*');
    // Some providers include the leading `./` or full paths; strip
    // prefixes and dedupe to the first path segment.
    const seen = new Set<string>();
    for (const raw of entries) {
      const cleaned = raw.replace(/^\.?\//, '');
      const head = cleaned.split('/')[0];
      if (head && head !== '') {
        seen.add(head);
      }
    }
    return Array.from(seen).sort().slice(0, 5);
  } catch {
    return [];
  }
}

// ─── Environment ──────────────────────────────────────────────────────

export interface EnvironmentInput {
  /** Working directory the agent operates from (workspace root). */
  cwd: string;
  /** OS / arch string, e.g. "Linux x86_64" (best-effort from `uname`). */
  platform?: string;
  /** Whether `cwd` is inside a git work tree. */
  isGitRepo?: boolean;
  /** Today's date (YYYY-MM-DD) so the agent isn't anchored to its cutoff. */
  today?: string;
  /** The model id driving this session. */
  model?: string;
}

/**
 * Render the session's environment block — mirrors the orienting context
 * Claude Code injects (cwd, platform, is-git-repo, today's date, model).
 * Skipped entirely when no environment was gathered (no eager workspace).
 */
export function renderEnvironment(env: EnvironmentInput | undefined): string | null {
  if (!env) {
    return null;
  }
  const lines: string[] = ['## Environment', `- cwd: ${env.cwd}`];
  if (env.platform) {
    lines.push(`- platform: ${env.platform}`);
  }
  if (env.isGitRepo !== undefined) {
    lines.push(`- is-git-repo: ${env.isGitRepo ? 'yes' : 'no'}`);
  }
  if (env.today) {
    lines.push(`- today: ${env.today}`);
  }
  if (env.model) {
    lines.push(`- model: ${env.model}`);
  }
  return lines.join('\n');
}

// ─── Git status ───────────────────────────────────────────────────────

export interface GitStatusInput {
  /** Current branch (`git branch --show-current`). */
  branch?: string;
  /** Default/main branch, when detectable. */
  mainBranch?: string;
  /** Committer identity, e.g. "Ada <ada@example.com>". */
  user?: string;
  /** `git status --short` output (already trimmed + capped). */
  status?: string;
  /** `git log --oneline -n N` output. */
  recentCommits?: string;
}

/**
 * Render the git status block — branch, main branch, user, working-tree
 * status, and recent commits. Mirrors Claude Code's `gitStatus` context.
 * Returns `null` when nothing was gathered (e.g. not a git repo).
 */
export function renderGitStatus(git: GitStatusInput | undefined): string | null {
  if (!git) {
    return null;
  }
  const has =
    git.branch || git.mainBranch || git.user || git.status?.trim() || git.recentCommits?.trim();
  if (!has) {
    return null;
  }
  const lines: string[] = ['## Git status'];
  if (git.branch) {
    lines.push(`- branch: ${git.branch}`);
  }
  if (git.mainBranch) {
    lines.push(`- main branch: ${git.mainBranch}`);
  }
  if (git.user) {
    lines.push(`- git user: ${git.user}`);
  }
  if (git.status?.trim()) {
    lines.push('', 'Status (`git status --short`):', git.status.trimEnd());
  }
  if (git.recentCommits?.trim()) {
    lines.push('', 'Recent commits:', git.recentCommits.trimEnd());
  }
  return lines.join('\n');
}

// ─── CLAUDE.md / AGENTS.md walk ───────────────────────────────────────

/**
 * Render the discovered CLAUDE.md / AGENTS.md files in root-first order.
 * Each file is rendered with a path header. Truncated files are noted
 * inline so the agent knows the full content was clipped.
 */
export function renderClaudeMd(files: ClaudeMdFile[]): string | null {
  if (files.length === 0) {
    return null;
  }
  const lines: string[] = ['## Project directives'];
  for (const file of files) {
    lines.push('');
    const note = file.truncated ? ' (truncated)' : '';
    lines.push(`### ${file.path}${note}`);
    lines.push(file.content.trimEnd());
  }
  return lines.join('\n');
}

// ─── Skill summaries ──────────────────────────────────────────────────

/**
 * Render the available skills.
 *
 * Two modes, chosen automatically:
 *  - **Inline** — when every skill carries a `body`, the bodies are
 *    rendered in full under per-skill `###` headers. Used in v1, where
 *    the agent has no `skills.read` tool yet (see plans/agents §2).
 *  - **Summary** — when no bodies are supplied, only name + description
 *    show, with a note that the body is fetchable via `skills.read`.
 *    This is the progressive-disclosure path for once that tool exists.
 *
 * Empty array → section omitted.
 */
export function renderSkillSummaries(
  skills: ReadonlyArray<{ name: string; description: string; body?: string }>,
): string | null {
  if (skills.length === 0) {
    return null;
  }
  const hasBody = (s: { body?: string }): boolean => !!s.body && s.body.trim() !== '';
  const allInline = skills.every(hasBody);

  const lines: string[] = ['## Available skills'];
  if (!allInline) {
    lines.push(
      'Each skill below is fetchable on demand via `skills.read`. Only the name and description are shown here.',
    );
  }
  lines.push('');

  for (const s of skills) {
    const body = s.body?.trim();
    if (body) {
      lines.push(`### ${s.name}`, s.description, '', body, '');
    } else {
      lines.push(`- **${s.name}** — ${s.description}`);
    }
  }
  return lines.join('\n').trimEnd();
}

// ─── Tool restrictions (deny list) ────────────────────────────────────

/**
 * Soft mention of denied tools. Hard enforcement lives in the security
 * hooks; this exists so the model doesn't burn turns trying disallowed
 * tools.
 */
export function renderDenyList(denyList: ReadonlyArray<string>): string | null {
  if (denyList.length === 0) {
    return null;
  }
  return [
    '## Tool restrictions',
    `You are not permitted to use: ${denyList.join(', ')}.`,
    'Attempting to call them will be hard-blocked at the SDK layer.',
  ].join('\n');
}

// ─── Available tools ──────────────────────────────────────────────────

export function renderAvailableTools(
  tools: ReadonlyArray<{ name: string; description: string }>,
): string | null {
  if (tools.length === 0) {
    return null;
  }
  const lines: string[] = ['## Available tools'];
  for (const t of tools) {
    lines.push(`- **${t.name}** — ${t.description}`);
  }
  return lines.join('\n');
}

// ─── Memory excerpts ──────────────────────────────────────────────────

export function renderMemory(
  memory: ReadonlyArray<{ scope: string; content: string }>,
): string | null {
  if (memory.length === 0) {
    return null;
  }
  const lines: string[] = ['## Relevant memories'];
  for (const m of memory) {
    lines.push(`- (${m.scope}) ${m.content}`);
  }
  return lines.join('\n');
}

// ─── Session plan ─────────────────────────────────────────────────────

export function renderPlan(
  plan: { checkpoints: ReadonlyArray<{ id: string; label: string; status: string }> } | undefined,
): string | null {
  if (!plan || plan.checkpoints.length === 0) {
    return null;
  }
  const lines: string[] = ['## Session plan'];
  for (const c of plan.checkpoints) {
    const box = checkpointBox(c.status);
    lines.push(`- ${box} ${c.label}`);
  }
  return lines.join('\n');
}

function checkpointBox(status: string): string {
  switch (status) {
    case 'done':
      return '[x]';
    case 'doing':
      return '[~]';
    case 'blocked':
      return '[!]';
    default:
      return '[ ]';
  }
}

// ─── Attachments appendix ─────────────────────────────────────────────

export function renderAttachments(
  attachments: ReadonlyArray<{ name: string; mediaType: string; description?: string }>,
): string | null {
  if (attachments.length === 0) {
    return null;
  }
  const lines: string[] = ['## Attachments'];
  for (const a of attachments) {
    const desc = a.description ? ` — ${a.description}` : '';
    lines.push(`- ${a.name} (${a.mediaType})${desc}`);
  }
  return lines.join('\n');
}

// ─── Operating directives ─────────────────────────────────────────────

/**
 * Always-rendered closing block: stop conditions, commit-message style,
 * output format. Kept short — most of the behaviour is conveyed by the
 * persona; this section is just the universal guard rails.
 */
export function renderOperatingDirectives(): string {
  return [
    '## Operating directives',
    '- Stop when the task is done. Do not gold-plate.',
    '- Orient before acting: list the tree and read package.json / README / CLAUDE.md to learn the structure and how to run tests.',
    '- Find code with `grep` / `glob`, not by guessing paths. Read with `read_file` (use line ranges for large files); read a file before editing it.',
    '- Before changing a symbol, grep its definition AND its usages to gauge the blast radius of the change.',
    '- Prefer focused edits over full rewrites; use `multi_edit` for several edits to one file.',
    '- Verify your work: after edits, run the project’s tests / typecheck / lint and fix what you broke.',
    '- Use `git log` / `git blame` to understand why code is the way it is before changing it.',
    "- When committing, follow the repository's existing commit-message style.",
    '- Record durable facts about the codebase with `memory.write`; recall them with `memory.search`.',
    '- Report back concisely when finished — what was done, what remains, what was found.',
  ].join('\n');
}
