/**
 * McpPanel — the org's MCP server registry with per-session opt-in.
 *
 * This is the only MCP surface: the registry CRUD (add / remove a server)
 * and the per-chat toggle live here together, so configuring a server and
 * enabling it for the open chat is one trip.
 *
 * Wired to the real `/mcp-servers` catalogue. The toggle writes the
 * server id into (or out of) the active session's `enabledMcpServerIds`
 * via PATCH /sessions/:id. Without an active session the toggles are
 * disabled (there's nothing to opt into) — adding servers still works.
 *
 * Transport-specific config:
 *   - stdio: { command: string; args?: string[]; env?: Record<string,string> }
 *   - http / sse: { url: string; headers?: Record<string,string> }
 *
 * `config` is a raw JSON textarea to keep the surface area small. A
 * friendlier per-transport form lands later.
 */
import * as React from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import type { AgentMcpServer, AgentSession, McpTransport } from '../../../shared/types';
import { useCreateMcpServer, useDeleteMcpServer, useMcpServers } from '../../hooks/useMcpServers';
import { useUpdateSession } from '../../hooks/useSessions';
import { Switch } from '../ui/switch';

const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse'];

export function McpPanel({ session }: { session: AgentSession | null }): React.ReactElement {
  const { data: servers, isLoading, error } = useMcpServers();
  const createServer = useCreateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const updateSession = useUpdateSession();
  const [showForm, setShowForm] = React.useState(false);

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
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Org-wide registry. Toggle a server to use it in this chat.
        </p>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          title={showForm ? 'Cancel' : 'Add server'}
          aria-label={showForm ? 'Cancel' : 'Add server'}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="agents-mcp-add-button"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>

      {showForm ? (
        <CreateForm
          onCancel={() => setShowForm(false)}
          onSubmit={async (input) => {
            await createServer.mutateAsync(input);
            setShowForm(false);
          }}
          submitting={createServer.isPending}
          error={createServer.error ? (createServer.error as Error).message : null}
        />
      ) : null}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading servers…
          </div>
        ) : error ? (
          <p className="py-12 text-center text-sm text-destructive">
            Failed to load MCP servers: {(error as Error).message}
          </p>
        ) : !servers || servers.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
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
              onDelete={() => deleteServer.mutate({ id: server.id })}
              deleting={deleteServer.isPending}
            />
          ))
        )}
      </div>
      {!session ? (
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
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
  onDelete,
  deleting,
}: {
  server: AgentMcpServer;
  enabled: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
  deleting: boolean;
}): React.ReactElement {
  const handleDelete = () => {
    if (deleting) {
      return;
    }
    const ok = window.confirm(`Remove "${server.name}"? Chats using it lose access to its tools.`);
    if (ok) {
      onDelete();
    }
  };

  return (
    <div className="group rounded-lg px-3 py-2.5 hover:bg-muted/40">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{server.name}</span>
        <span className="shrink-0 text-[11px] uppercase text-muted-foreground">
          {server.transport}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          title="Remove server"
          aria-label={`Remove ${server.name}`}
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${server.name}`}
        />
      </div>
      <code className="mt-1.5 block truncate font-mono text-[11px] text-muted-foreground">
        {endpointLabel(server)}
      </code>
    </div>
  );
}

function CreateForm({
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    description?: string | null;
    transport: McpTransport;
    config: Record<string, unknown>;
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}): React.ReactElement {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [transport, setTransport] = React.useState<McpTransport>('stdio');
  const [configText, setConfigText] = React.useState('{}');
  const [parseError, setParseError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let config: Record<string, unknown>;
    try {
      const parsed = JSON.parse(configText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config must be a JSON object');
      }
      config = parsed as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      return;
    }
    setParseError(null);
    await onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      transport,
      config,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2.5 border-b border-border bg-card/40 px-3 py-3"
      data-testid="agents-mcp-create-form"
    >
      <label className="block">
        <span className="text-[11px] font-medium text-muted-foreground">Name</span>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium text-muted-foreground">Transport</span>
        <select
          value={transport}
          onChange={(e) => setTransport(e.target.value as McpTransport)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
        >
          {TRANSPORTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[11px] font-medium text-muted-foreground">
          Description (optional)
        </span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium text-muted-foreground">Config (JSON)</span>
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px]"
          placeholder={
            transport === 'stdio'
              ? '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] }'
              : '{ "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }'
          }
        />
        {parseError ? <div className="mt-1 text-[11px] text-destructive">{parseError}</div> : null}
      </label>
      {error ? <div className="text-[11px] text-destructive">{error}</div> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-card"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
