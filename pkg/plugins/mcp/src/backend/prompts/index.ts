/**
 * MCP Prompts — reusable prompt templates for common Flowlib tasks.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';

export function registerPrompts(server: McpServer, _client: FlowlibClient): void {
  server.registerPrompt(
    'debug-flow-run',
    {
      description: 'Analyze a failed or problematic flow run to identify the root cause',
      argsSchema: { flowRunId: z.string().describe('The flow run ID to debug') },
    },
    async ({ flowRunId }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Debug the flow run "${flowRunId}". Follow these steps:`,
                '',
                '1. Use run_get to fetch the run details (status, error, timing).',
                '2. Use debug_node_executions to get per-node traces.',
                '3. Identify which node(s) failed or produced unexpected output.',
                '4. If the failing node is an AGENT, use run_get_tool_executions on its nodeExecutionId to see every tool call the agent made.',
                "5. If a node has an expression error, use debug_test_expression with the failed expression and the node's input data.",
                '6. Summarize: root cause, which node failed, and suggest a fix.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'create-flow',
    {
      description: 'Step-by-step guide to create a new flow with nodes and connections',
      argsSchema: {
        name: z.string().describe('Name for the new flow'),
        description: z.string().optional().describe('What the flow should do'),
      },
    },
    async ({ name, description }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Create a new Flowlib flow called "${name}"${description ? `: ${description}` : ''}.`,
                '',
                'Follow these steps:',
                '1. Use node_list_available (or node_list_for_provider if you already know the integration) to pick node types.',
                '2. Use flow_create to create the flow.',
                '3. For every node that references an external resource (e.g. a Slack channel, a Google Sheet), call node_resolve_field_options to look up valid IDs rather than guessing.',
                '4. Use version_publish to publish the flow definition with nodes and edges.',
                '5. Use flow_validate to verify the definition is correct before running.',
                '6. Use trigger_sync if the flow contains trigger nodes that should be registered (cron, webhook).',
                '7. Optionally use run_start (sync) or run_start_async (background) to test the flow.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'explain-flow',
    {
      description: 'Get a detailed explanation of what a flow does, its nodes, and data flow',
      argsSchema: { flowId: z.string().describe('The flow ID to explain') },
    },
    async ({ flowId }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Explain the flow "${flowId}" in detail.`,
                '',
                '1. Use flow_get to get the flow metadata.',
                '2. Use flow_get_definition to get the full definition.',
                '3. Analyze the nodes, their types, parameters, and connections (edges).',
                '4. Describe the data flow from inputs through each node to outputs.',
                '5. Flag any potential issues or improvements.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'diagnose-credential',
    {
      description: 'Diagnose a credential that is failing, expiring, or not working as expected',
      argsSchema: {
        credentialId: z
          .string()
          .optional()
          .describe('Specific credential id to diagnose — omit to audit all'),
      },
    },
    async ({ credentialId }) => {
      const focus = credentialId
        ? `credential \`${credentialId}\``
        : 'every credential in the system';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Diagnose ${focus}.`,
                '',
                '1. Use credential_list to see every credential and its type.',
                '2. Use credential_list_expiring to surface anything close to expiry.',
                '3. For each suspect credential, call credential_test to verify connectivity.',
                '4. If an OAuth2 credential is failing, reference credential_list_oauth2_providers for docs URLs and expected scopes.',
                '5. Summarise which credentials are healthy, which are expiring, and concrete next steps.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}
