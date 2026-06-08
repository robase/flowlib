/**
 * McpServersPage — `/agents/mcp-servers`.
 *
 * Org-scoped MCP server registry. Add a server here, then opt into it
 * per-chat from the chat settings drawer.
 *
 * Transport-specific config:
 *   - stdio: { command: string; args?: string[]; env?: Record<string,string> }
 *   - http / sse: { url: string; headers?: Record<string,string> }
 *
 * v1 uses a raw JSON textarea for `config` to keep the surface area
 * small. A friendlier per-transport form lands later.
 */

import * as React from 'react';
import type { AgentMcpServer, McpTransport } from '../../shared/types';
import { useCreateMcpServer, useDeleteMcpServer, useMcpServers } from '../hooks/useMcpServers';

const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse'];

export interface McpServersPageProps {
  basePath: string;
}

export function McpServersPage(_: McpServersPageProps): React.ReactElement {
  const { data: servers, isLoading, error } = useMcpServers();
  const createServer = useCreateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const [showForm, setShowForm] = React.useState(false);

  return (
    <div
      className="fl-page w-full h-full min-h-0 overflow-y-auto bg-background text-foreground"
      data-testid="mcp-servers-page"
    >
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">MCP servers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Org-wide MCP server registry. Toggle per chat from the chat settings.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {showForm ? 'Cancel' : '+ Add server'}
        </button>
      </header>

      {showForm && (
        <CreateForm
          onCancel={() => setShowForm(false)}
          onSubmit={async (input) => {
            await createServer.mutateAsync(input);
            setShowForm(false);
          }}
          submitting={createServer.isPending}
        />
      )}

      <div className="px-6 py-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : !servers || servers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            No MCP servers configured yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                onDelete={() => deleteServer.mutate({ id: server.id })}
                deleting={deleteServer.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ServerRow({
  server,
  onDelete,
  deleting,
}: {
  server: AgentMcpServer;
  onDelete: () => void;
  deleting: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-4 px-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{server.name}</div>
        <div className="text-xs text-muted-foreground">
          {server.transport}
          {server.description ? ` · ${server.description}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="text-xs text-destructive hover:underline disabled:opacity-50"
      >
        Remove
      </button>
    </li>
  );
}

function CreateForm({
  onCancel,
  onSubmit,
  submitting,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    description?: string | null;
    transport: McpTransport;
    config: Record<string, unknown>;
  }) => Promise<void>;
  submitting: boolean;
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
      className="border-b border-border bg-card/40 px-6 py-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Transport</span>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as McpTransport)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            {TRANSPORTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Description (optional)</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Config (JSON)</span>
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          placeholder={
            transport === 'stdio'
              ? '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] }'
              : '{ "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }'
          }
        />
        {parseError && <div className="text-xs text-destructive mt-1">{parseError}</div>}
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-card"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      Failed to load MCP servers: {message}
    </div>
  );
}

export default McpServersPage;
