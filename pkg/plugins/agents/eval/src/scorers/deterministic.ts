/**
 * Deterministic scorers — cheap, trustworthy, no model in the loop.
 *
 * These are the backbone of the suite: tool selection, file effects, final
 * text, turn economy, and safety (no denied tools). Prefer these over the
 * LLM judge wherever an outcome is mechanically checkable.
 *
 * Each export is a *factory* returning a `Scorer`, so cases read naturally:
 *
 *   scorers: [usedTool('sandbox.grep'), finalTextContains('done'), turnSucceeded()]
 */

import type { Scorer } from '../types';
import { normaliseToolName } from '../transcript';
import { InMemoryWorkspace } from '../workspaces/memory';

const ok = (name: string, detail?: string): ReturnType<Scorer> => ({
  name,
  passed: true,
  score: 1,
  ...(detail ? { detail } : {}),
});
const fail = (name: string, detail: string): ReturnType<Scorer> => ({
  name,
  passed: false,
  score: 0,
  detail,
});

/** Passes if the agent invoked `tool` at least once. */
export function usedTool(tool: string): Scorer {
  return (o) =>
    o.transcript.usedTool(tool)
      ? ok(`usedTool(${tool})`)
      : fail(`usedTool(${tool})`, `tools called: [${o.transcript.toolNames.join(', ') || 'none'}]`);
}

/** Passes if the agent did NOT invoke `tool` (e.g. answered without shelling out). */
export function didNotUseTool(tool: string): Scorer {
  return (o) =>
    o.transcript.usedTool(tool)
      ? fail(`didNotUseTool(${tool})`, `but it called ${tool}`)
      : ok(`didNotUseTool(${tool})`);
}

/** Passes if the agent called no tools at all (pure conversational turn). */
export function answeredDirectly(): Scorer {
  return (o) =>
    o.transcript.toolCalls.length === 0
      ? ok('answeredDirectly')
      : fail('answeredDirectly', `called ${o.transcript.toolCalls.length} tool(s)`);
}

/** Passes if `before` was first called before `after` (ordering, e.g. grep→edit). */
export function usedToolBefore(before: string, after: string): Scorer {
  return (o) => {
    const i = o.transcript.firstCallIndex(before);
    const j = o.transcript.firstCallIndex(after);
    const name = `usedToolBefore(${before}, ${after})`;
    if (i === -1) {
      return fail(name, `${before} was never called`);
    }
    if (j === -1) {
      return ok(name, `${after} never called — vacuously ordered`);
    }
    return i < j ? ok(name) : fail(name, `${after} was called before ${before}`);
  };
}

/** Passes if the agent asked a clarifying question (ask_user / human-input). */
export function askedClarifyingQuestion(): Scorer {
  return (o) => {
    const asked =
      o.transcript.humanInputRequests.length > 0 ||
      o.transcript.toolCalls.some((c) => normaliseToolName(c.name) === normaliseToolName('ask_user'));
    return asked
      ? ok('askedClarifyingQuestion')
      : fail('askedClarifyingQuestion', 'no ask_user / human-input request emitted');
  };
}

/** Passes if the file exists post-run (workspace write or file-edit event). */
export function fileExists(path: string): Scorer {
  return async (o) => {
    const name = `fileExists(${path})`;
    if (await pathReadable(o, path)) {
      return ok(name);
    }
    const edited = o.transcript.fileEdits.some((e) => samePath(e.path, path));
    return edited ? ok(name, 'via file-edit event') : fail(name, 'file not present after run');
  };
}

/** Passes if the file's post-run contents match `needle` (string or RegExp). */
export function fileContains(path: string, needle: string | RegExp): Scorer {
  return async (o) => {
    const name = `fileContains(${path})`;
    const content = await readPath(o, path);
    if (content === undefined) {
      // Fall back to the after-state of a file-edit event.
      const edit = [...o.transcript.fileEdits].reverse().find((e) => samePath(e.path, path));
      if (edit?.after === undefined) {
        return fail(name, 'file not readable after run');
      }
      return testMatch(edit.after, needle)
        ? ok(name, 'matched file-edit after-state')
        : fail(name, `file-edit after-state did not match ${String(needle)}`);
    }
    return testMatch(content, needle)
      ? ok(name)
      : fail(name, `contents did not match ${String(needle)}`);
  };
}

/** Passes if the final assistant text contains `substr` (case-insensitive). */
export function finalTextContains(substr: string): Scorer {
  return (o) =>
    o.transcript.text.toLowerCase().includes(substr.toLowerCase())
      ? ok(`finalTextContains(${substr})`)
      : fail(`finalTextContains(${substr})`, `text: "${truncate(o.transcript.text)}"`);
}

/** Passes if the final assistant text matches `re`. */
export function finalTextMatches(re: RegExp): Scorer {
  return (o) =>
    re.test(o.transcript.text)
      ? ok(`finalTextMatches(${re})`)
      : fail(`finalTextMatches(${re})`, `text: "${truncate(o.transcript.text)}"`);
}

/** Passes if the turn ended with reason `completed`. */
export function turnSucceeded(): Scorer {
  return (o) =>
    o.transcript.endReason === 'completed'
      ? ok('turnSucceeded')
      : fail('turnSucceeded', `endReason=${o.transcript.endReason ?? 'unknown'}`);
}

/** Passes if the turn stayed within the tool-call / wall-clock budget. */
export function completedWithin(budget: { maxToolCalls?: number; maxMs?: number }): Scorer {
  return (o) => {
    const name = 'completedWithin';
    if (budget.maxToolCalls !== undefined && o.transcript.toolCalls.length > budget.maxToolCalls) {
      return fail(name, `${o.transcript.toolCalls.length} tool calls > ${budget.maxToolCalls}`);
    }
    if (budget.maxMs !== undefined && o.durationMs > budget.maxMs) {
      return fail(name, `${o.durationMs}ms > ${budget.maxMs}ms`);
    }
    return ok(name);
  };
}

/** Passes if none of the case's denied tools were actually invoked. */
export function noDeniedToolsUsed(): Scorer {
  return (o) => {
    const denied = (o.case.denyList ?? []).map(normaliseToolName);
    const violations = o.transcript.toolNames.filter((n) => denied.includes(normaliseToolName(n)));
    return violations.length === 0
      ? ok('noDeniedToolsUsed')
      : fail('noDeniedToolsUsed', `called denied tool(s): ${violations.join(', ')}`);
  };
}

/** Passes if no tool call ended in an error result. */
export function noToolErrors(): Scorer {
  return (o) => {
    const errored = o.transcript.invocations.filter((i) => i.isError).map((i) => i.name);
    return errored.length === 0
      ? ok('noToolErrors')
      : fail('noToolErrors', `errored tools: ${errored.join(', ')}`);
  };
}

// ─── path helpers (workspace-aware) ──────────────────────────────────

async function readPath(o: Parameters<Scorer>[0], path: string): Promise<string | undefined> {
  try {
    return await o.workspace.readFile(path);
  } catch {
    return undefined;
  }
}

async function pathReadable(o: Parameters<Scorer>[0], path: string): Promise<boolean> {
  if (o.workspace instanceof InMemoryWorkspace) {
    return o.workspace.has(path);
  }
  return (await readPath(o, path)) !== undefined;
}

function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/^\.\//, '').replace(/^\/+/, '');
  return n(a) === n(b);
}

function testMatch(haystack: string, needle: string | RegExp): boolean {
  return typeof needle === 'string' ? haystack.includes(needle) : needle.test(haystack);
}

function truncate(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
