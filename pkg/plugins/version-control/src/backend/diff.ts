// =============================================================================
// Phase 7 — Diff viewer data model
//
// Produces a side-by-side, line-oriented diff of the git branch version and
// the local DB version. The output is intentionally UI-friendly rather than a
// patch format: each row carries both remote and local line numbers/content so
// a frontend can render a split diff without re-running diff logic in-browser.
// =============================================================================

import type { VcFlowDiffLine } from '../shared/types';

type DiffOp =
  | { type: 'context'; remoteIndex: number; localIndex: number; content: string }
  | { type: 'removed'; remoteIndex: number; content: string }
  | { type: 'added'; localIndex: number; content: string };

export function buildSideBySideDiff(remoteContent: string, localContent: string): VcFlowDiffLine[] {
  const remoteLines = splitLines(remoteContent);
  const localLines = splitLines(localContent);
  const ops = buildDiffOps(remoteLines, localLines);
  return coalesceChangedRows(ops);
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function buildDiffOps(remoteLines: string[], localLines: string[]): DiffOp[] {
  const dp: number[][] = Array.from({ length: remoteLines.length + 1 }, () =>
    Array(localLines.length + 1).fill(0),
  );

  for (let i = remoteLines.length - 1; i >= 0; i--) {
    for (let j = localLines.length - 1; j >= 0; j--) {
      if (remoteLines[i] === localLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < remoteLines.length && j < localLines.length) {
    if (remoteLines[i] === localLines[j]) {
      ops.push({ type: 'context', remoteIndex: i, localIndex: j, content: remoteLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'removed', remoteIndex: i, content: remoteLines[i] });
      i++;
    } else {
      ops.push({ type: 'added', localIndex: j, content: localLines[j] });
      j++;
    }
  }

  while (i < remoteLines.length) {
    ops.push({ type: 'removed', remoteIndex: i, content: remoteLines[i] });
    i++;
  }
  while (j < localLines.length) {
    ops.push({ type: 'added', localIndex: j, content: localLines[j] });
    j++;
  }

  return ops;
}

function coalesceChangedRows(ops: DiffOp[]): VcFlowDiffLine[] {
  const rows: VcFlowDiffLine[] = [];
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'context') {
      rows.push({
        kind: 'context',
        remoteLineNumber: op.remoteIndex + 1,
        localLineNumber: op.localIndex + 1,
        remoteContent: op.content,
        localContent: op.content,
      });
      i++;
      continue;
    }

    const removed: Extract<DiffOp, { type: 'removed' }>[] = [];
    const added: Extract<DiffOp, { type: 'added' }>[] = [];
    while (i < ops.length && ops[i].type === 'removed') {
      removed.push(ops[i] as Extract<DiffOp, { type: 'removed' }>);
      i++;
    }
    while (i < ops.length && ops[i].type === 'added') {
      added.push(ops[i] as Extract<DiffOp, { type: 'added' }>);
      i++;
    }

    const paired = Math.min(removed.length, added.length);
    for (let p = 0; p < paired; p++) {
      rows.push({
        kind: 'changed',
        remoteLineNumber: removed[p].remoteIndex + 1,
        localLineNumber: added[p].localIndex + 1,
        remoteContent: removed[p].content,
        localContent: added[p].content,
      });
    }
    for (let r = paired; r < removed.length; r++) {
      rows.push({
        kind: 'removed',
        remoteLineNumber: removed[r].remoteIndex + 1,
        localLineNumber: null,
        remoteContent: removed[r].content,
        localContent: null,
      });
    }
    for (let a = paired; a < added.length; a++) {
      rows.push({
        kind: 'added',
        remoteLineNumber: null,
        localLineNumber: added[a].localIndex + 1,
        remoteContent: null,
        localContent: added[a].content,
      });
    }
  }

  return rows;
}
