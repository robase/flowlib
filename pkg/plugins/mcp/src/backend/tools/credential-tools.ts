/**
 * Credential tools — reference-only (list metadata, test connectivity).
 * No create/delete/get-values for security.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import { mapCredentialList, mapTestResult, mapOAuth2ProviderList } from '../response-mappers';

export function registerCredentialTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.CREDENTIAL_LIST,
    {
      description:
        'List all credentials with their names, types, and providers. Does NOT expose secrets — only metadata for referencing in flow configs.',
      inputSchema: {},
    },
    async () => {
      const creds = await client.listCredentials();
      return { content: [{ type: 'text', text: mapCredentialList(creds) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.CREDENTIAL_TEST,
    {
      description:
        'Test connectivity of a credential by ID. Verifies the credential is valid and can reach the external service.',
      inputSchema: { credentialId: z.string().describe('The credential ID to test') },
    },
    async ({ credentialId }) => {
      const result = await client.testCredential(credentialId);
      return { content: [{ type: 'text', text: mapTestResult(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.CREDENTIAL_LIST_OAUTH2_PROVIDERS,
    {
      description:
        'List all built-in OAuth2 providers (Google, GitHub, Slack, …) with their scopes and docs URLs. Read-only — does not start a flow.',
      inputSchema: {},
    },
    async () => {
      const providers = await client.listOAuth2Providers();
      return { content: [{ type: 'text', text: mapOAuth2ProviderList(providers) }] };
    },
  );
}
