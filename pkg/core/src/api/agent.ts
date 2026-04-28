import type { AgentAPI } from './types';
import { getGlobalActionRegistry } from '@flowlib/actions/registry';
import type { ServiceFactory } from '../services/service-factory';
import type { BatchProvider } from '../services/ai/base-client';
import { detectProviderFromCredential } from '../utils/provider-detection';
import type { AgentToolDefinition } from '../types/agent-tool.types';

export function createAgentAPI(sf: ServiceFactory): AgentAPI {
  const baseAIClient = sf.getBaseAIClient();

  async function ensureAdapterForCredential(
    credentialId: string,
    providerHint?: BatchProvider | string,
  ): Promise<void> {
    if (providerHint && baseAIClient.hasAdapter(providerHint as BatchProvider)) {
      return;
    }

    const credentialsService = sf.getCredentialsService();
    const credential = await credentialsService.getDecryptedWithRefresh(credentialId);
    const apiKey = (credential.config as Record<string, unknown>)?.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error(`Credential "${credentialId}" does not contain an apiKey.`);
    }

    const detected = detectProviderFromCredential(credential);
    if (!detected) {
      throw new Error(`Unable to detect AI provider from credential "${credentialId}".`);
    }
    if (baseAIClient.hasAdapter(detected)) {
      return;
    }

    const { BatchProvider: BP } = await import('../services/ai/base-client');
    const label =
      detected === BP.OPENAI ? 'OPENAI' : detected === BP.ANTHROPIC ? 'ANTHROPIC' : 'OPENROUTER';
    baseAIClient.registerAdapter(label, apiKey);
  }

  return {
    getTools() {
      const registry = getGlobalActionRegistry();
      const defs: AgentToolDefinition[] = [];
      for (const action of registry.getAll()) {
        const toolDef = registry.toAgentToolDefinition(action.id);
        if (toolDef) {
          defs.push(toolDef);
        }
      }
      return defs;
    },

    async submitPrompt(request) {
      await ensureAdapterForCredential(request.credentialId, request.provider);
      return baseAIClient.runAgentPrompt(request, request.provider);
    },
  };
}
