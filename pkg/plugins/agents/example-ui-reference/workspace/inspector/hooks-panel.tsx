'use client';

import { ShieldAlert, ShieldX, EyeOff, AlertTriangle, Ban } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/workspace/format';
import type { AuditEvent, AuditEventType, HookHandler } from '@/lib/workspace/types';

const EVENT_META: Record<
  AuditEventType,
  { icon: typeof ShieldAlert; className: string; label: string }
> = {
  tool_blocked: { icon: ShieldX, className: 'text-destructive', label: 'Tool blocked' },
  secret_redacted: { icon: EyeOff, className: 'text-info', label: 'Secret redacted' },
  secret_terminated: { icon: Ban, className: 'text-destructive', label: 'Secret terminated' },
  sanitizer_warning: { icon: AlertTriangle, className: 'text-warning', label: 'Sanitizer warning' },
  mcp_rejected: { icon: ShieldAlert, className: 'text-warning', label: 'MCP rejected' },
};

export function HooksPanel({ hooks, events }: { hooks: HookHandler[]; events: AuditEvent[] }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {/* Handlers */}
      <section>
        {hooks.map((hook) => (
          <div key={hook.id} className="rounded-md px-3 py-2 hover:bg-muted/40">
            <div className="flex items-center gap-2">
              <code className="truncate font-mono text-xs font-medium text-foreground">
                {hook.name}
              </code>
              <span className="shrink-0 text-[11px] text-muted-foreground">{hook.phase}</span>
              <Switch
                className="ml-auto scale-90"
                checked={hook.enabled}
                aria-label={`Toggle ${hook.name}`}
              />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hook.description}</p>
          </div>
        ))}
      </section>

      {/* Audit feed */}
      <section className="mt-4">
        <h3 className="mb-2 px-3 text-[11px] font-medium text-muted-foreground">Audit log</h3>
        <ol className="space-y-3 px-3">
          {events.map((event) => {
            const meta = EVENT_META[event.type];
            const Icon = meta.icon;
            return (
              <li key={event.id} className="flex gap-2.5">
                <span className={cn('mt-0.5 shrink-0', meta.className)}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-medium', meta.className)}>{meta.label}</span>
                    <code className="truncate font-mono text-[11px] text-muted-foreground">
                      {event.tool}
                    </code>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(event.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {event.reason}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
