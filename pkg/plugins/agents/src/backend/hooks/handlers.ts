/**
 * Security hook handlers (Stream S1).
 *
 * Concrete PreToolUse / PostToolUse handlers the pipeline chains:
 *   - `sensitivePathDeny`  — block file tools touching secrets / escaping the workspace
 *   - `dangerousBashBlock` — block destructive / pipe-to-shell commands
 *   - `secretRedaction`    — redact secret patterns in tool output; terminate on private keys
 *
 * Handlers return a `SecurityDecision` — the base hook decision plus an
 * optional `audit` event the pipeline emits. They are pure + synchronous
 * so they're trivially unit-tested.
 */

import type { AgentAuditEventType } from '../audit/writer';
import type {
  HookDecision,
  PostHookDecision,
  PostToolUseContext,
  PreToolUseContext,
} from './types';

export interface SecurityAudit {
  eventType: AgentAuditEventType;
  payload?: Record<string, unknown>;
}
export interface SecurityPreDecision extends HookDecision<unknown> {
  audit?: SecurityAudit;
}
export interface SecurityPostDecision extends PostHookDecision<unknown> {
  audit?: SecurityAudit;
}
export type SecurityPreHandler = (
  ctx: PreToolUseContext<unknown>,
) => SecurityPreDecision | void | Promise<SecurityPreDecision | void>;
export type SecurityPostHandler = (
  ctx: PostToolUseContext<unknown, unknown>,
) => SecurityPostDecision | void | Promise<SecurityPostDecision | void>;

// ─── Tool classification ───────────────────────────────────────────────

const FILE_TOOL = /(?:^|[._])(?:read_file|write_file|edit_file|read|write|edit)$/i;
const SHELL_TOOL = /(?:^|[._])(?:run_shell|shell|bash|exec|git)$/i;

function isFileTool(name: string): boolean {
  return FILE_TOOL.test(name);
}
function isShellTool(name: string): boolean {
  return SHELL_TOOL.test(name);
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value);
  }
}

// ─── Sensitive path deny ───────────────────────────────────────────────

const SENSITIVE_PATH: ReadonlyArray<RegExp> = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)\.git\//i,
  /(?:^|\/)\.ssh\//i,
  /(?:^|\/)\.aws\//i,
  /\bid_(?:rsa|ed25519|ecdsa|dsa)\b/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /(?:^|\/)credentials\b/i,
];
/** A `..` path segment — workspace escape. */
const TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/;

export const sensitivePathDeny: SecurityPreHandler = (ctx) => {
  if (!isFileTool(ctx.toolName)) {
    return;
  }
  const input = asRecord(ctx.input);
  const path = String(input.path ?? input.file ?? input.filename ?? '');
  if (path === '') {
    return;
  }
  const matched = TRAVERSAL.test(path) || SENSITIVE_PATH.some((re) => re.test(path));
  if (!matched) {
    return;
  }
  return {
    continue: false,
    reason: `Blocked: "${ctx.toolName}" on a sensitive or out-of-workspace path (${path}).`,
    audit: { eventType: 'tool_blocked', payload: { rule: 'sensitive_path', path } },
  };
};

// ─── Dangerous bash block ──────────────────────────────────────────────

const DANGEROUS_CMD: ReadonlyArray<{ rule: string; re: RegExp }> = [
  {
    // Bounded quantifiers (no overlapping `*`) so the ReDoS heuristic is
    // satisfied; matches `rm -rf` / `-fr` / `-Rf` etc. targeting a root.
    rule: 'rm_rf_root',
    re: /\brm\s{1,4}-[a-z]{0,4}r[a-z]{0,4}\b[^/~$\n]{0,200}(?:\/|~|\$HOME)(?:\s|$)/i,
  },
  { rule: 'fork_bomb', re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  {
    rule: 'pipe_to_shell',
    re: /\b(?:curl|wget)\b[^|\n]{0,300}\|\s{0,4}(?:sudo )?(?:sh|bash|zsh)\b/i,
  },
  { rule: 'mkfs', re: /\bmkfs/i },
  { rule: 'dd_to_device', re: /\bdd\b[^\n]{0,200}\bof=\/dev\/[a-z]/i },
  { rule: 'chmod_777_root', re: /\bchmod\s+-?R?\s*777\s+\//i },
  { rule: 'overwrite_block_device', re: />\s*\/dev\/sd[a-z]/i },
];

export const dangerousBashBlock: SecurityPreHandler = (ctx) => {
  if (!isShellTool(ctx.toolName)) {
    return;
  }
  const input = asRecord(ctx.input);
  // `run_shell` uses `command`; the `git` wrapper uses `args`.
  const command = `${String(input.command ?? '')} ${String(input.args ?? '')}`.trim();
  if (command === '') {
    return;
  }
  const hit = DANGEROUS_CMD.find(({ re }) => re.test(command));
  if (!hit) {
    return;
  }
  return {
    continue: false,
    reason: `Blocked: command matches a destructive pattern (${hit.rule}).`,
    audit: { eventType: 'tool_blocked', payload: { rule: hit.rule, command } },
  };
};

// ─── Secret redaction ──────────────────────────────────────────────────

/** Private-key material → hard terminate (too sensitive to even redact-and-continue). */
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // Anthropic
  /\bsk-[A-Za-z0-9]{20,}\b/g, // OpenAI
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
];

export const secretRedaction: SecurityPostHandler = (ctx) => {
  const text = stringifyOutput(ctx.output);
  if (text === '') {
    return;
  }
  if (PRIVATE_KEY.test(text)) {
    return {
      terminate: true,
      reason: 'Private key material detected in tool output — session terminated.',
      audit: { eventType: 'secret_terminated', payload: { toolName: ctx.toolName } },
    };
  }
  let count = 0;
  let redacted = text;
  for (const re of SECRET_PATTERNS) {
    redacted = redacted.replace(re, () => {
      count++;
      return '[REDACTED]';
    });
  }
  if (count === 0) {
    return;
  }
  return {
    continue: true,
    modifiedOutput: redacted,
    reason: `Redacted ${count} secret(s) from tool output.`,
    audit: { eventType: 'secret_redacted', payload: { count, toolName: ctx.toolName } },
  };
};

/** The default security handler set, in order. */
export const DEFAULT_PRE_HANDLERS: ReadonlyArray<SecurityPreHandler> = [
  sensitivePathDeny,
  dangerousBashBlock,
];
export const DEFAULT_POST_HANDLERS: ReadonlyArray<SecurityPostHandler> = [secretRedaction];
