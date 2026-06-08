/**
 * McpPanel — the org's MCP server registry with per-session opt-in.
 *
 * Wired to the real `/mcp-servers` catalogue. The toggle writes the
 * server id into (or out of) the active session's `enabledMcpServerIds`
 * via PATCH /sessions/:id. Without an active session the toggles are
 * disabled (there's nothing to opt into).
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentMcpServer, AgentSession } from '../../../shared/types';
import { useMcpServers } from '../../hooks/useMcpServers';
import { useUpdateSession } from '../../hooks/useSessions';
import { Switch } from '../ui/switch';

export function McpPanel({ session }: { session: AgentSession | null }): React.ReactElement {
  const { data: servers, isLoading, error } = useMcpServers();
  const updateSession = useUpdateSession();

  const enabledIds = React.useMemo(
    () => new Set(session?.enabledMcpServerIds ?? []),
    [session?.enabledMcpServerIds],
  );

  const toggle = (serverId: string, next: boolean) => {
    if (!session) {
      return;
    }
    const current = session.enabledMcpServerIds ?? [];
    const nextIds = next
      ? Array.from(new Set([...current, serverId]))
      : current.filter((id) => id !== serverId);
    updateSession.mutate({ id: session.id, input: { enabledMcpServerIds: nextIds } });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fl-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading servers…
          </div>
        ) : error ? (
          <p className="py-12 text-center text-sm text-fl-destructive">
            Failed to load MCP servers: {(error as Error).message}
          </p>
        ) : !servers || servers.length === 0 ? (
          <p className="py-12 text-center text-sm text-fl-muted-foreground">
            No MCP servers configured yet.
          </p>
        ) : (
          servers.map((server) => (
            <McpRow
              key={server.id}
              server={server}
              enabled={enabledIds.has(server.id)}
              disabled={!session || updateSession.isPending}
              onToggle={(next) => toggle(server.id, next)}
            />
          ))
        )}
      </div>
      {!session ? (
        <p className="border-t border-fl-border px-4 py-2 text-[11px] text-fl-muted-foreground">
          Open a chat to enable servers for it.
        </p>
      ) : null}
    </div>
  );
}

function endpointLabel(server: AgentMcpServer): string {
  const config = server.config ?? {};
  if (typeof config.url === 'string') {
    return config.url;
  }
  if (typeof config.command === 'string') {
    const args = Array.isArray(config.args) ? config.args.join(' ') : '';
    return `${config.command}${args ? ` ${args}` : ''}`;
  }
  return server.transport;
}

function McpRow({
  server,
  enabled,
  disabled,
  onToggle,
}: {
  server: AgentMcpServer;
  enabled: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}): React.ReactElement {
  return (
    <div className="rounded-lg px-3 py-2.5 hover:bg-fl-muted/40">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-fl-foreground">{server.name}</span>
        <span className="shrink-0 text-[11px] uppercase text-fl-muted-foreground">
          {server.transport}
        </span>
        <Switch
          className="ml-auto"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${server.name}`}
        />
      </div>
      <code className="mt-1.5 block truncate font-mono text-[11px] text-fl-muted-foreground">
        {endpointLabel(server)}
      </code>
    </div>
  );
}
