/**
 * Chat Memory — Browser-local persistence via localStorage.
 *
 * Stores notes in two scopes:
 *   - Flow-scoped:     localStorage key = `flowlib:chat-memory:flow:<flowId>`
 *   - Workspace-scoped: localStorage key = `flowlib:chat-memory:workspace`
 *
 * Each key stores a JSON array of strings (the note contents).
 * Maximum 50 notes per scope to prevent unbounded growth.
 */

const FLOW_KEY_PREFIX = 'flowlib:chat-memory:flow:';
const WORKSPACE_KEY = 'flowlib:chat-memory:workspace';
const MAX_NOTES = 50;

function getKey(scope: 'flow' | 'workspace', flowId?: string): string {
  if (scope === 'flow') {
    if (!flowId) {
      throw new Error('flowId required for flow-scoped memory');
    }
    return `${FLOW_KEY_PREFIX}${flowId}`;
  }
  return WORKSPACE_KEY;
}

function readNotes(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function writeNotes(key: string, notes: string[]): void {
  localStorage.setItem(key, JSON.stringify(notes.slice(0, MAX_NOTES)));
}

// =====================================
// Public API
// =====================================

export function getMemoryNotes(scope: 'flow' | 'workspace', flowId?: string): string[] {
  return readNotes(getKey(scope, flowId));
}

export function saveMemoryNote(
  scope: 'flow' | 'workspace',
  content: string,
  flowId?: string,
): void {
  const key = getKey(scope, flowId);
  const notes = readNotes(key);
  // Avoid duplicates
  if (!notes.includes(content)) {
    notes.push(content);
    writeNotes(key, notes);
  }
}

export function deleteMemoryNote(
  scope: 'flow' | 'workspace',
  content: string,
  flowId?: string,
): void {
  const key = getKey(scope, flowId);
  const notes = readNotes(key);
  const filtered = notes.filter((n) => n !== content);
  writeNotes(key, filtered);
}

/**
 * Get all memory notes for a flow (flow-scoped + workspace-scoped).
 * Returns the shape expected by ChatContext.memoryNotes.
 */
export function getAllMemoryNotes(flowId?: string): {
  flowNotes: string[];
  workspaceNotes: string[];
} {
  return {
    flowNotes: flowId ? getMemoryNotes('flow', flowId) : [],
    workspaceNotes: getMemoryNotes('workspace'),
  };
}
