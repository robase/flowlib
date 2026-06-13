/**
 * Providers endpoint — exposes the deployment's registered agent
 * providers + their curated model lists so the chat picker is
 * **backend-driven** rather than hardcoded in the frontend.
 *
 *   GET /agents/providers
 *     → { data: ProviderDescriptor[], defaultProviderId }
 *
 * Why this exists: which providers are registered (`claude-code`,
 * `opencode`, `ai-sdk`, …) and which model specs they accept is a
 * per-deployment concern. A hardcoded frontend catalogue can't know
 * that a host wired an OpenRouter gateway (so models must be
 * `openrouter/...`) vs direct vendors (`anthropic/...`). The frontend
 * builds its picker from this response and only falls back to its
 * built-in catalogue when the endpoint is unavailable.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentProvider } from '../providers/types';
import { type EndpointDeps, safeHandler } from './helpers';

/** A single model option as surfaced to the UI picker. */
interface ProviderModelDescriptor {
  id: string;
  label: string;
  description?: string;
}

/** A registered provider as surfaced to the UI picker. */
interface ProviderDescriptor {
  id: string;
  name: string;
  icon?: string;
  defaultModel?: string;
  capabilities: AgentProvider['capabilities'];
  models: ProviderModelDescriptor[];
}

async function listProviders(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const registry = deps.pluginCtx.registries.providers as Map<string, AgentProvider> | undefined;
  const providers = registry ? [...registry.values()] : [];

  const data: ProviderDescriptor[] = await Promise.all(
    providers.map(async (p) => {
      let models: ProviderModelDescriptor[] = [];
      try {
        const listed = (await p.listModels?.()) ?? [];
        models = listed.map((m) => {
          const description = (m.metadata as { description?: string } | undefined)?.description;
          return { id: m.id, label: m.name, ...(description ? { description } : {}) };
        });
      } catch {
        // A provider that can't enumerate models still appears in the
        // picker — the frontend falls back to its default model.
        models = [];
      }
      return {
        id: p.id,
        name: p.name,
        ...(p.icon ? { icon: p.icon } : {}),
        ...(p.defaultModel ? { defaultModel: p.defaultModel } : {}),
        capabilities: p.capabilities,
        models,
      };
    }),
  );

  return {
    status: 200,
    body: { data, defaultProviderId: deps.pluginCtx.options.defaultProviderId },
  };
}

export function createProvidersEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/agents/providers',
      handler: safeHandler(ctx, listProviders),
    },
  ];
}
