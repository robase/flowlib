/**
 * `composeSystemPrompt` — the orchestrator.
 *
 * Builds the per-session system prompt by calling section builders in
 * the order defined in `plans/agents/prompt-and-skills.md`:
 *
 *   1. Persona
 *   2. Workspace context
 *   3. CLAUDE.md / AGENTS.md walk
 *   4. Skill summaries
 *   5. Tool restrictions (soft)
 *   6. Available tools
 *   7. Memory excerpts
 *   8. Session plan
 *   9. Attachments appendix
 *  10. Operating directives
 *
 * The full prompt is built once at session start. Per-turn additions
 * (new attachments, new memory hits) are appended as user-message
 * metadata, NOT by re-rendering the system prompt.
 */

import type { WorkspaceHandle } from '../workspaces/types';
import { walkClaudeMd, DEFAULT_MAX_BYTES_PER_FILE, type ClaudeMdFile } from './claude-md-walk';
import {
  renderAttachments,
  renderAvailableTools,
  renderClaudeMd,
  renderDenyList,
  renderMemory,
  renderOperatingDirectives,
  renderSystemPrompt,
  renderPlan,
  renderSkillSummaries,
  renderWorkspaceContext,
} from './sections';

/**
 * Input to `composeSystemPrompt`. The shape is intentionally a
 * superset of what each builder consumes — section builders pluck out
 * what they need.
 *
 * Empty arrays / undefined fields cause their section to be omitted
 * rather than rendered as "empty" with a header. Operating directives
 * is the one always-rendered section.
 */
export interface ComposeInput {
  /** System prompt — the opening of the prompt. May be empty. */
  systemPrompt: string;
  /**
   * Workspace context — omit for raw-LLM (no-workspace) sessions. When
   * present, the composer also runs the CLAUDE.md walk from
   * `workspace.cwd` (defaults to `rootPath`) up to `rootPath`.
   */
  workspace?: {
    handle: WorkspaceHandle;
    rootPath: string;
    /**
     * Where to start the CLAUDE.md walk. Defaults to `rootPath`. Useful
     * when the user has cd'd into a subdirectory of the workspace and
     * we want directives from that directory and its ancestors only.
     */
    cwd?: string;
    repoSummary?: string;
    branch?: string;
    /** Per-file truncation budget for the CLAUDE.md walk. Default 8 KB. */
    claudeMdMaxBytesPerFile?: number;
  };
  /** Skill summaries (name + description only). Bodies fetched on demand. */
  skillSummaries: ReadonlyArray<{ name: string; description: string }>;
  /** Tools the role/session is denied. Soft mention only. */
  denyList: ReadonlyArray<string>;
  /** Tools available this session — one-line summary per tool. */
  availableTools: ReadonlyArray<{ name: string; description: string }>;
  /** Top-k memory excerpts for the session. Empty in v1. */
  memory: ReadonlyArray<{ scope: string; content: string }>;
  /** Session plan checkpoints. */
  plan?: { checkpoints: ReadonlyArray<{ id: string; label: string; status: string }> };
  /** Files attached to the user message at session start. */
  attachments: ReadonlyArray<{ name: string; mediaType: string; description?: string }>;
}

/**
 * Build the per-session system prompt.
 *
 * Section ordering and emptiness behaviour live in the spec
 * ([prompt-and-skills.md](../../../../../plans/agents/prompt-and-skills.md)).
 */
export async function composeSystemPrompt(input: ComposeInput): Promise<string> {
  const sections: Array<string | null> = [];

  // 1. System prompt
  sections.push(renderSystemPrompt(input.systemPrompt));

  // 2. Workspace context (skipped if no workspace)
  sections.push(await renderWorkspaceContext(input.workspace));

  // 3. CLAUDE.md / AGENTS.md walk (only with a workspace)
  let claudeMdFiles: ClaudeMdFile[] = [];
  if (input.workspace) {
    claudeMdFiles = await walkClaudeMd(
      input.workspace.handle,
      input.workspace.cwd ?? input.workspace.rootPath,
      input.workspace.rootPath,
      input.workspace.claudeMdMaxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE,
    );
  }
  sections.push(renderClaudeMd(claudeMdFiles));

  // 4. Skill summaries
  sections.push(renderSkillSummaries(input.skillSummaries));

  // 5. Tool restrictions
  sections.push(renderDenyList(input.denyList));

  // 6. Available tools
  sections.push(renderAvailableTools(input.availableTools));

  // 7. Memory excerpts
  sections.push(renderMemory(input.memory));

  // 8. Session plan
  sections.push(renderPlan(input.plan));

  // 9. Attachments appendix
  sections.push(renderAttachments(input.attachments));

  // 10. Operating directives (always rendered)
  sections.push(renderOperatingDirectives());

  return sections.filter((s): s is string => s !== null && s !== '').join('\n\n');
}

export type { ClaudeMdFile } from './claude-md-walk';
export { walkClaudeMd, OutOfRootError, DEFAULT_MAX_BYTES_PER_FILE } from './claude-md-walk';
