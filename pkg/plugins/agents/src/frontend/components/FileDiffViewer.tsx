/**
 * FileDiffViewer — renders before/after for a `file-edit` event.
 *
 * v1 uses a plain unified-diff view computed via a small line-based
 * LCS-style differ — no external diff library. The two `<pre>` blocks
 * are styled with `fl-*` theme tokens. The `path` is rendered above
 * the diff with a small "+N -M" hunk summary.
 *
 * **Upgrade path**: swap the inline differ for `diff2html-react` or
 * `react-diff-viewer-continued`. Keep the prop surface stable.
 */
import * as React from 'react';
import type { FileEditEvent } from '../../shared/events';

export interface FileDiffViewerProps {
  event: FileEditEvent;
  /** Render side-by-side instead of unified. Defaults to unified. */
  layout?: 'unified' | 'split';
}

interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

/** Tiny line-level diff. Not meant for huge files — render-time only. */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = before === '' ? [] : before.split('\n');
  const afterLines = after === '' ? [] : after.split('\n');

  // Trivial cases.
  if (beforeLines.length === 0) {
    return afterLines.map((text) => ({ kind: 'added' as const, text }));
  }
  if (afterLines.length === 0) {
    return beforeLines.map((text) => ({ kind: 'removed' as const, text }));
  }

  // Compute LCS table for line-level diff. O(n*m) — fine for v1.
  const n = beforeLines.length;
  const m = afterLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      out.push({ kind: 'context', text: beforeLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'removed', text: beforeLines[i] });
      i++;
    } else {
      out.push({ kind: 'added', text: afterLines[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: 'removed', text: beforeLines[i++] });
  }
  while (j < m) {
    out.push({ kind: 'added', text: afterLines[j++] });
  }
  return out;
}

export const FileDiffViewer: React.FC<FileDiffViewerProps> = ({ event, layout = 'unified' }) => {
  const before = event.before ?? '';
  const after = event.after ?? '';
  const lines = React.useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter((l) => l.kind === 'added').length;
  const removed = lines.filter((l) => l.kind === 'removed').length;

  return (
    <div
      className="rounded border border-fl-border bg-fl-card my-2"
      data-testid="file-diff"
      data-path={event.path}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-fl-border">
        <span className="font-mono text-xs truncate text-fl-foreground">{event.path}</span>
        <span className="text-xs text-fl-muted-foreground shrink-0 ml-2">
          <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>{' '}
          <span className="text-fl-destructive">-{removed}</span>
        </span>
      </div>
      {layout === 'split' ? <SplitView lines={lines} /> : <UnifiedView lines={lines} />}
    </div>
  );
};

FileDiffViewer.displayName = 'FileDiffViewer';

const UnifiedView: React.FC<{ lines: DiffLine[] }> = ({ lines }) => (
  <pre className="text-xs font-mono m-0 p-2 overflow-x-auto whitespace-pre">
    {lines.map((line, idx) => (
      <div key={idx} className={lineClass(line.kind)}>
        <span aria-hidden="true" className="select-none mr-1">
          {prefixForKind(line.kind)}
        </span>
        {line.text}
      </div>
    ))}
  </pre>
);

const SplitView: React.FC<{ lines: DiffLine[] }> = ({ lines }) => {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  for (const line of lines) {
    if (line.kind === 'context') {
      left.push(line);
      right.push(line);
    } else if (line.kind === 'removed') {
      left.push(line);
      right.push({ kind: 'context', text: '' });
    } else {
      left.push({ kind: 'context', text: '' });
      right.push(line);
    }
  }
  return (
    <div className="grid grid-cols-2 divide-x divide-fl-border">
      <pre className="text-xs font-mono m-0 p-2 overflow-x-auto whitespace-pre">
        {left.map((line, idx) => (
          <div key={idx} className={lineClass(line.kind)}>
            {line.text}
          </div>
        ))}
      </pre>
      <pre className="text-xs font-mono m-0 p-2 overflow-x-auto whitespace-pre">
        {right.map((line, idx) => (
          <div key={idx} className={lineClass(line.kind)}>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
};

function lineClass(kind: DiffLine['kind']): string {
  switch (kind) {
    case 'added':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'removed':
      return 'bg-fl-destructive/10 text-fl-destructive';
    default:
      return 'text-fl-muted-foreground';
  }
}

function prefixForKind(kind: DiffLine['kind']): string {
  if (kind === 'added') {
    return '+';
  }
  if (kind === 'removed') {
    return '-';
  }
  return ' ';
}
