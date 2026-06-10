'use client';

import { useState } from 'react';
import {
  ChevronRight,
  Terminal,
  Check,
  X,
  ShieldAlert,
  Loader2,
  Brain,
  BookOpen,
  FileEdit,
  FileText,
  Trash2,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCall } from '@/lib/workspace/types';

function toolIcon(name: string) {
  if (name.startsWith('memory')) {
    return Brain;
  }
  if (name.startsWith('skills')) {
    return BookOpen;
  }
  if (name === 'write_file') {
    return FileEdit;
  }
  if (name === 'read_file') {
    return FileText;
  }
  if (name === 'delete_file') {
    return Trash2;
  }
  if (name === 'run_shell') {
    return Terminal;
  }
  return Wrench;
}

const STATUS_META = {
  success: { icon: Check, className: 'text-success', label: 'ok' },
  error: { icon: X, className: 'text-destructive', label: 'error' },
  blocked: { icon: ShieldAlert, className: 'text-warning', label: 'blocked' },
  running: { icon: Loader2, className: 'text-info animate-spin', label: 'running' },
} as const;

export function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(call.status === 'error' || call.status === 'blocked');
  const Icon = toolIcon(call.name);
  const meta = STATUS_META[call.status];
  const StatusIcon = meta.icon;
  const argText = Object.entries(call.args)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('  ');

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border text-sm',
        call.status === 'blocked'
          ? 'border-warning/40 bg-warning/5'
          : call.status === 'error'
            ? 'border-destructive/40 bg-destructive/5'
            : 'border-border bg-muted/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <code className="shrink-0 font-mono text-xs font-medium text-foreground">{call.name}</code>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {argText}
        </span>
        <span className={cn('flex shrink-0 items-center gap-1 text-[11px]', meta.className)}>
          <StatusIcon className="h-3.5 w-3.5" />
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-3 py-2">
          {call.output ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
              {call.output}
            </pre>
          ) : (
            <p className="font-mono text-xs text-muted-foreground/70">(no output)</p>
          )}
        </div>
      )}
    </div>
  );
}
