'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Sparkles, Pin, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { AgentSession } from '@/lib/workspace/types';
import { StatusDot } from './status-dot';

interface SessionListProps {
  sessions: AgentSession[];
  activeSessionId: string;
  onSelect: (id: string) => void;
}

export function SessionList({ sessions, activeSessionId, onSelect }: SessionListProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Brand + new session */}
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Agent Workspace</span>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="New session">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            className="h-8 pl-8 text-sm"
            aria-label="Search sessions"
          />
        </div>
      </div>

      {/* Sessions */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 px-2 pb-4">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No sessions match.
            </p>
          ) : (
            filtered.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelect(session.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors',
                    active ? 'bg-sidebar-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <StatusDot status={session.status} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      active ? 'font-medium text-sidebar-accent-foreground' : 'text-foreground',
                    )}
                  >
                    {session.title}
                  </span>
                  {session.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </div>
  );
}
