/**
 * REST endpoints for `agent_mcp_servers` — org-scoped MCP server
 * registry.
 *
 * MCP servers are configured once per org (like credentials) and toggled
 * per session via `PATCH /sessions/:id { enabledMcpServerIds: [...] }`.
 *
 * Routes:
 *
 *   GET    /mcp-servers
 *   POST   /mcp-servers
 *   GET    /mcp-servers/:id
 *   PATCH  /mcp-servers/:id
 *   DELETE /mcp-servers/:id
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { McpTransport } from '../../shared/types';
import { badRequest, notFound, safeHandler, type EndpointDeps } from './helpers';

interface CreateMcpBody {
  name?: string;
  description?: string | null;
  transport?: McpTransport;
  config?: Record<string, unknown>;
}

interface UpdateMcpBody {
  name?: string;
  description?: string | null;
  transport?: McpTransport;
  config?: Record<string, unknown>;
}

const VALID_TRANSPORTS: ReadonlySet<McpTransport> = new Set(['stdio', 'http', 'sse']);

async function listServers(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.mcpServers.list({ orgId: deps.auth.orgId });
  return { body: { data: rows } };
}

async function getServer(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.mcpServers.findById(id, deps.auth.orgId);
  if (!row) {
    return notFound('MCP server not found');
  }
  return { body: row };
}

async function createServer(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateMcpBody;
  if (!body.name || typeof body.name !== 'string') {
    return badRequest('name is required');
  }
  if (!body.transport || !VALID_TRANSPORTS.has(body.transport)) {
    return badRequest('transport must be one of: stdio, http, sse');
  }
  const created = await deps.repos.mcpServers.create({
    orgId: deps.auth.orgId,
    name: body.name,
    description: body.description ?? null,
    transport: body.transport,
    config: body.config ?? {},
    createdBy: deps.auth.userId,
  });
  return { status: 201, body: created };
}

async function updateServer(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.mcpServers.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('MCP server not found');
  }
  const body = (deps.endpointCtx.body ?? {}) as UpdateMcpBody;
  if (body.transport !== undefined && !VALID_TRANSPORTS.has(body.transport)) {
    return badRequest('transport must be one of: stdio, http, sse');
  }
  const updated = await deps.repos.mcpServers.update(
    id,
    {
      name: body.name,
      description: body.description,
      transport: body.transport,
      config: body.config,
    },
    deps.auth.orgId,
  );
  if (!updated) {
    return notFound('MCP server not found');
  }
  return { body: updated };
}

async function deleteServer(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.mcpServers.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('MCP server not found');
  }
  await deps.repos.mcpServers.delete(id, deps.auth.orgId);
  return { status: 204, body: null };
}

export function createMcpServersEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    { method: 'GET', path: '/agents/mcp-servers', handler: safeHandler(ctx, listServers) },
    { method: 'POST', path: '/agents/mcp-servers', handler: safeHandler(ctx, createServer) },
    { method: 'GET', path: '/agents/mcp-servers/:id', handler: safeHandler(ctx, getServer) },
    { method: 'PATCH', path: '/agents/mcp-servers/:id', handler: safeHandler(ctx, updateServer) },
    { method: 'DELETE', path: '/agents/mcp-servers/:id', handler: safeHandler(ctx, deleteServer) },
  ];
}
