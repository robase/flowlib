'use client';

import { useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MemoryRecord, MemoryScope } from '@/lib/workspace/types';

const SCOPE_STYLE: Record<MemoryScope, string> = {
  personal: 'border-info/40 text-info',
  project: 'border-primary/40 text-primary',
  global: 'border-warning/40 text-warning',
};

export function MemoryPanel({
  memories,
  onDelete,
}: {
  memories: MemoryRecord[];
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<MemoryScope | 'all'>('all');
  const q = query.trim().toLowerCase();

  const filtered = memories.filter((m) => {
    if (scope !== 'all' && m.scope !== scope) {
      return false;
    }
    if (q && !m.content.toLowerCase().includes(q) && !m.tags.some((t) => t.includes(q))) {
      return false;
    }
    return true;
  });

  const scopes: (MemoryScope | 'all')[] = ['all', 'personal', 'project', 'global'];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 px-4 pt-2 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories…"
            className="h-8 pl-8 text-sm"
            aria-label="Search memories"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors',
                scope === s
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No memories match.</p>
        ) : (
          filtered.map((m) => (
            <div key={m.id} className="group rounded-lg px-3 py-2.5 hover:bg-muted/40">
              <p className="text-sm leading-relaxed text-foreground">{m.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cn('text-[11px] capitalize', SCOPE_STYLE[m.scope])}>
                  {m.scope}
                </span>
                {m.tags.map((t) => (
                  <span key={t} className="text-[11px] text-muted-foreground">
                    #{t}
                  </span>
                ))}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={() => onDelete(m.id)}
                  aria-label="Delete memory"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
