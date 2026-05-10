/**
 * Tool output truncation + overflow store — Stream G.
 *
 * Large tool outputs (10k-row SQL responses, full file dumps, lengthy
 * `Bash` stdout) flood the model context and burn tokens. Per
 * [tools-and-mcp.md#tool-result-truncation](../../../../../plans/agents/tools-and-mcp.md):
 *
 * - **Inline budget** per tool result is the first **100 lines OR 4 KB**,
 *   whichever comes first. Configurable per-agent via
 *   `agent_sessions.toolOutputBudget`.
 * - When the output exceeds budget the *full* output is persisted in one
 *   of two places, depending on whether the call has a workspace handle:
 *   - **Workspace-attached** (Claude Code, opencode): the full output is
 *     written to `<workspace>/.flowlib/tool-outputs/<toolCallId>.txt` via
 *     `WorkspaceHandle.writeFile`. The agent reaches it through the
 *     provider-native `Grep` / `Read offset/limit` / `Glob` tools — no
 *     special MCP needed because the file lives in the workspace.
 *   - **Workspace-less** (raw-LLM, post-v1): the full output is held in
 *     DO storage (Cloudflare) or the session's blob store (Express,
 *     deferred). v1 holds it in an in-memory `Map`; Stream H later swaps
 *     the map for actual DO storage. The agent retrieves slices via the
 *     bridge's built-in `read_tool_output` MCP tool.
 * - The truncated inline view always ends with a footer pointing at
 *   wherever the rest lives so the agent knows it exists.
 *
 * Per the brief: a single store instance can serve both workspace-attached
 * and workspace-less calls — the workspace handle is supplied at `store()`
 * time, not at construction time.
 */

import type { WorkspaceHandle } from '../workspaces/types';

/** Default inline budget — first-N defined by [tools-and-mcp.md]. */
export const DEFAULT_TOOL_OUTPUT_BUDGET: ToolOutputBudget = {
  lines: 100,
  bytes: 4096,
};

/** Per-agent / per-session budget shape. */
export interface ToolOutputBudget {
  /** Max lines kept inline; 0 disables the lines cap. */
  lines: number;
  /** Max bytes (UTF-8) kept inline; 0 disables the bytes cap. */
  bytes: number;
}

/** Result of a `store()` call. */
export interface ToolOutputStoreResult {
  /**
   * String the agent / model sees. Either the original (when the input
   * fits) or the first-N + footer.
   */
  inline: string;
  /** True when the input exceeded the budget and was overflow-stored. */
  truncated: boolean;
  /**
   * When truncated:
   *   • workspace-attached → the workspace-relative file path
   *     (e.g. `.flowlib/tool-outputs/abc123.txt`)
   *   • workspace-less → the `toolCallId`. Use `read_tool_output` (or
   *     the store's `readSlice`) to fetch back.
   * Undefined when the output fit inline.
   */
  fullOutputRef?: string;
  /** Total bytes (UTF-8) of the original output. */
  totalBytes: number;
  /** Total lines (count of `\n` + 1) of the original output. */
  totalLines: number;
}

/** Input to a single `store()` call. */
export interface StoreInput {
  /** Tool call id — used as the file path / map key. */
  toolCallId: string;
  /** Raw tool output. Strings pass through; everything else is JSON-stringified. */
  output: unknown;
  /** Per-call budget override; defaults to the store's configured budget. */
  budget?: Partial<ToolOutputBudget>;
  /**
   * Workspace where overflow is written. Present for workspace-attached
   * agents (Claude Code, opencode); absent for raw-LLM where the bridge
   * keeps overflow in the in-memory map.
   */
  workspace?: WorkspaceHandle;
}

/** The store interface — Stream A wires this into the per-turn loop. */
export interface ToolOutputStore {
  /**
   * Persist `input.output`. If it fits within the inline budget the
   * original is returned verbatim. If it overflows, the full output
   * is sent to either the workspace file or the in-memory map and a
   * truncated head + footer is returned.
   *
   * Workspace write failures are logged but do not throw — the agent
   * still gets a usable inline view, and the store falls back to
   * the in-memory map so `read_tool_output` still works.
   */
  store(input: StoreInput): Promise<ToolOutputStoreResult>;
  /**
   * Workspace-less reads: fetch a previously-stored full output by
   * `toolCallId`. Used by the `read_tool_output` MCP fallback tool
   * the bridge registers when no workspace is attached.
   */
  readFullOutput(toolCallId: string): Promise<string | undefined>;
  /**
   * Slice a previously-stored full output. Mirrors the planned
   * `read_tool_output` MCP tool surface: `offset`/`limit` are
   * line-based, `grep` filters by substring before slicing.
   */
  readSlice(
    toolCallId: string,
    opts?: { offset?: number; limit?: number; grep?: string },
  ): Promise<string | undefined>;
  /** Drop a stored output. Idempotent. */
  forget(toolCallId: string): Promise<void>;
}

/** Factory options. */
export interface CreateToolOutputStoreOptions {
  /** Default budget applied when a `store()` call doesn't override. */
  budget?: Partial<ToolOutputBudget>;
  /** Optional logger; failures are logged via `warn`. */
  logger?: {
    warn(message: string, ...args: unknown[]): void;
    debug?(message: string, ...args: unknown[]): void;
  };
  /** Subdirectory under the workspace root. Defaults to `.flowlib/tool-outputs`. */
  subdir?: string;
}

const DEFAULT_SUBDIR = '.flowlib/tool-outputs';

/**
 * Build a `ToolOutputStore`. The store is stateful only for the
 * workspace-less path (it owns the in-memory `Map`); workspace-attached
 * calls write straight through to the supplied handle.
 */
export function createToolOutputStore(opts: CreateToolOutputStoreOptions = {}): ToolOutputStore {
  const defaultBudget = mergeBudget(DEFAULT_TOOL_OUTPUT_BUDGET, opts.budget);
  const subdir = opts.subdir ?? DEFAULT_SUBDIR;
  const logger = opts.logger;

  // Workspace-less full outputs. Keyed by toolCallId. Stream H will
  // swap this for actual DO storage; the contract is the same.
  const inMemoryFullOutputs = new Map<string, string>();

  async function store(input: StoreInput): Promise<ToolOutputStoreResult> {
    const budget = mergeBudget(defaultBudget, input.budget);
    const text = stringifyOutput(input.output);
    const totalBytes = utf8ByteLength(text);
    const totalLines = countLines(text);

    const exceedsBytes = budget.bytes > 0 && totalBytes > budget.bytes;
    const exceedsLines = budget.lines > 0 && totalLines > budget.lines;

    if (!exceedsBytes && !exceedsLines) {
      return {
        inline: text,
        truncated: false,
        totalBytes,
        totalLines,
      };
    }

    const head = truncateToBudget(text, budget);

    // Workspace-attached: write through, fall back to in-memory on failure.
    if (input.workspace) {
      const path = joinPath(subdir, `${sanitizeId(input.toolCallId)}.txt`);
      try {
        await input.workspace.writeFile(path, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger?.warn(
          `[tool-output-store] workspace.writeFile failed for ${input.toolCallId}: ${msg}; ` +
            'falling back to in-memory storage so read_tool_output still works.',
        );
        inMemoryFullOutputs.set(input.toolCallId, text);
        const inline = appendFooter({
          head,
          fullOutputRef: input.toolCallId,
          totalBytes,
          totalLines,
          budget,
          storage: 'session',
          extra: `[note: workspace write failed (${msg}) — using session storage fallback]`,
        });
        return {
          inline,
          truncated: true,
          fullOutputRef: input.toolCallId,
          totalBytes,
          totalLines,
        };
      }
      const inline = appendFooter({
        head,
        fullOutputRef: path,
        totalBytes,
        totalLines,
        budget,
        storage: 'workspace',
      });
      return {
        inline,
        truncated: true,
        fullOutputRef: path,
        totalBytes,
        totalLines,
      };
    }

    // Workspace-less: keep the full output in the in-memory map so the
    // built-in `read_tool_output` MCP tool can fetch it back.
    inMemoryFullOutputs.set(input.toolCallId, text);
    const inline = appendFooter({
      head,
      fullOutputRef: input.toolCallId,
      totalBytes,
      totalLines,
      budget,
      storage: 'session',
    });
    return {
      inline,
      truncated: true,
      fullOutputRef: input.toolCallId,
      totalBytes,
      totalLines,
    };
  }

  async function readFullOutput(toolCallId: string): Promise<string | undefined> {
    return inMemoryFullOutputs.get(toolCallId);
  }

  async function readSlice(
    toolCallId: string,
    sliceOpts?: { offset?: number; limit?: number; grep?: string },
  ): Promise<string | undefined> {
    const full = inMemoryFullOutputs.get(toolCallId);
    if (full === undefined) {
      return undefined;
    }

    const lines = full.split('\n');
    let view = lines;
    if (sliceOpts?.grep) {
      const needle = sliceOpts.grep;
      view = view.filter((line) => line.includes(needle));
    }
    const offset = Math.max(0, sliceOpts?.offset ?? 0);
    const limit =
      sliceOpts?.limit !== undefined ? Math.max(0, sliceOpts.limit) : view.length - offset;
    return view.slice(offset, offset + limit).join('\n');
  }

  async function forget(toolCallId: string): Promise<void> {
    inMemoryFullOutputs.delete(toolCallId);
  }

  return { store, readFullOutput, readSlice, forget };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function mergeBudget(
  base: ToolOutputBudget,
  override?: Partial<ToolOutputBudget>,
): ToolOutputBudget {
  return {
    lines: override?.lines ?? base.lines,
    bytes: override?.bytes ?? base.bytes,
  };
}

/**
 * Coerce arbitrary action output into a string suitable for line/byte
 * accounting. Strings pass through; everything else is pretty-JSON
 * serialised so the agent has something readable to grep across.
 */
export function stringifyOutput(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Circular refs etc. — fall back to a flat coercion.
    return String(value);
  }
}

function utf8ByteLength(s: string): number {
  // TextEncoder is always available in Workers and modern Node.
  return new TextEncoder().encode(s).length;
}

/** Count of lines — `\n`-delimited. Empty string is 0 lines. */
function countLines(s: string): number {
  if (s.length === 0) {
    return 0;
  }
  let count = 1;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10 /* \n */) {
      count++;
    }
  }
  // A trailing newline shouldn't bump the count past the visible lines.
  if (s.charCodeAt(s.length - 1) === 10) {
    count--;
  }
  return count;
}

/**
 * Slice the input down to whichever bound fires first. Both bounds are
 * applied — we keep the *intersection*: at most `lines` lines AND at
 * most `bytes` bytes.
 */
function truncateToBudget(s: string, budget: ToolOutputBudget): string {
  let cut = s.length;

  // Line bound — find the index of the (lines)-th `\n` and cut there.
  if (budget.lines > 0) {
    let seen = 0;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 10) {
        seen++;
        if (seen === budget.lines) {
          // Cut *after* this newline — keep the line that ended here.
          cut = Math.min(cut, i + 1);
          break;
        }
      }
    }
  }

  // Byte bound — TextEncoder gives us a precise UTF-8 length.
  if (budget.bytes > 0) {
    if (utf8ByteLength(s) > budget.bytes) {
      const sliced = sliceByBytes(s, budget.bytes);
      if (sliced.length < cut) {
        cut = sliced.length;
      }
    }
  }

  return s.slice(0, cut);
}

/** UTF-8-aware byte slice — never splits a multi-byte char. */
function sliceByBytes(s: string, maxBytes: number): string {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    let charBytes: number;
    if (code < 0x80) {
      charBytes = 1;
    } else if (code < 0x800) {
      charBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair → 4-byte UTF-8
      charBytes = 4;
      i++; // consume low surrogate
    } else {
      charBytes = 3;
    }
    if (bytes + charBytes > maxBytes) {
      return s.slice(0, code >= 0xd800 && code <= 0xdbff ? i - 1 : i);
    }
    bytes += charBytes;
  }
  return s;
}

interface FooterInput {
  head: string;
  fullOutputRef: string;
  totalBytes: number;
  totalLines: number;
  budget: ToolOutputBudget;
  storage: 'workspace' | 'session';
  extra?: string;
}

function appendFooter(input: FooterInput): string {
  const sep = input.head.endsWith('\n') ? '' : '\n';
  const budgetDesc = describeBudget(input.budget);
  const sizeDesc = `${input.totalLines} lines, ${formatBytes(input.totalBytes)}`;
  const lines: string[] = [`${sep}[output truncated at ${budgetDesc}]`];

  if (input.storage === 'workspace') {
    lines.push(
      `[full output: ${input.fullOutputRef} — ${sizeDesc}]`,
      `[use Grep / Read with offset/limit / Glob to query it]`,
    );
  } else {
    lines.push(
      `[full output stored in session — ${sizeDesc}]`,
      `[call read_tool_output with toolCallId="${input.fullOutputRef}" to fetch slices]`,
    );
  }
  if (input.extra) {
    lines.push(input.extra);
  }
  return input.head + lines.join('\n');
}

function describeBudget(budget: ToolOutputBudget): string {
  const parts: string[] = [];
  if (budget.lines > 0) {
    parts.push(`line ${budget.lines}`);
  }
  if (budget.bytes > 0) {
    parts.push(`${budget.bytes} bytes`);
  }
  return parts.length > 0 ? parts.join(' / ') : 'unbounded';
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function joinPath(dir: string, file: string): string {
  if (!dir) {
    return file;
  }
  return dir.endsWith('/') ? dir + file : `${dir}/${file}`;
}

/**
 * Strip path-traversal / shell-special characters from a tool-call id
 * before using it as a filename. We never trust upstream ids to be
 * filesystem-safe.
 */
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'tool-output';
}
