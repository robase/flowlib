/**
 * ToolsPanel — the active session's tool policy.
 *
 * Reads real fields off the session row: permission mode, the
 * enabled-tools allow-list, the deny-list, whether Flowlib actions are
 * exposed, and the tool-output truncation budget. There's no endpoint
 * enumerating every resolvable tool, so the list reflects the explicit
 * allow / deny entries the policy carries.
 */
import * as React from 'react';
import { Ban, Check, Wrench } from 'lucide-react';
import type { AgentSession } from '../../../shared/types';

export function ToolsPanel({ session }: { session: AgentSession | null }): React.ReactElement {
  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <Wrench className="h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium text-foreground">No chat open</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Open a chat to inspect its tool permissions.
        </p>
      </div>
    );
  }

  const enabled = session.enabledTools ?? [];
  const denied = session.denyList ?? [];
  const budget = session.toolOutputBudget;

  return (
    <div className="flex h-full flex-col">
      {/* Policy summary */}
      <div className="px-4 pt-2 pb-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <PolicyStat label="Permission mode" value={session.permissionMode ?? 'default'} />
          <PolicyStat
            label="Allow-list"
            value={enabled.length === 0 ? 'all allowed' : `${enabled.length} tools`}
          />
          <PolicyStat label="Flowlib actions" value={session.exposeFlowlibActions ? 'on' : 'off'} />
          <PolicyStat label="Output budget" value={`${budget.lines} ln / ${budget.bytes} B`} />
        </dl>
      </div>

      {/* Allow / deny entries */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3">
        {enabled.length === 0 && denied.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            No explicit allow/deny rules — all tools available to this session are allowed.
          </p>
        ) : (
          <>
            {enabled.map((name) => (
              <ToolRow key={`allow-${name}`} name={name} kind="allow" />
            ))}
            {denied.map((name) => (
              <ToolRow key={`deny-${name}`} name={name} kind="deny" />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ToolRow({ name, kind }: { name: string; kind: 'allow' | 'deny' }): React.ReactElement {
  const Icon = kind === 'allow' ? Check : Ban;
  return (
    <div className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-muted/40">
      <Icon
        className={`h-4 w-4 shrink-0 ${kind === 'allow' ? 'text-success' : 'text-destructive'}`}
      />
      <code className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
        {name}
      </code>
      <span
        className={`shrink-0 text-[11px] ${kind === 'allow' ? 'text-success' : 'text-destructive'}`}
      >
        {kind === 'allow' ? 'Allowed' : 'Denied'}
      </span>
    </div>
  );
}

function PolicyStat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[11px] capitalize text-foreground">{value}</dd>
    </div>
  );
}
