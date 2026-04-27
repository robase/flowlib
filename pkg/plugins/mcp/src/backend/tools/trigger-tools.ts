/**
 * Trigger management tools — CRUD for flow triggers (cron, webhook, manual).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import { mapTriggerList, mapTrigger } from '../response-mappers';

// Shape for create/update — kept loose because trigger configs vary by type.
const triggerInputSchema = z
  .object({
    flowId: z.string().optional(),
    triggerType: z.string().optional().describe('e.g. "cron", "webhook", "manual"'),
    type: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .passthrough();

export function registerTriggerTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.TRIGGER_LIST,
    {
      description: 'List all triggers configured for a flow (cron schedules, webhooks, manual)',
      inputSchema: { flowId: z.string().describe('The flow ID') },
    },
    async ({ flowId }) => {
      const triggers = await client.listTriggers(flowId);
      return { content: [{ type: 'text', text: mapTriggerList(triggers) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_GET,
    {
      description: 'Get details of a specific trigger',
      inputSchema: { triggerId: z.string().describe('The trigger ID') },
    },
    async ({ triggerId }) => {
      const trigger = await client.getTrigger(triggerId);
      return { content: [{ type: 'text', text: mapTrigger(trigger) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_CREATE,
    {
      description: 'Create a new trigger for a flow (e.g., cron schedule, webhook)',
      inputSchema: {
        input: triggerInputSchema.describe(
          'Trigger creation input including flowId, type, name, config',
        ),
      },
    },
    async ({ input }) => {
      const trigger = await client.createTrigger(input);
      return { content: [{ type: 'text', text: mapTrigger(trigger) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_UPDATE,
    {
      description: "Update an existing trigger's configuration",
      inputSchema: {
        triggerId: z.string().describe('The trigger ID to update'),
        input: triggerInputSchema.describe('Updated trigger configuration'),
      },
    },
    async ({ triggerId, input }) => {
      const trigger = await client.updateTrigger(triggerId, input);
      return { content: [{ type: 'text', text: mapTrigger(trigger) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_DELETE,
    {
      description: 'Delete a trigger',
      inputSchema: { triggerId: z.string().describe('The trigger ID to delete') },
    },
    async ({ triggerId }) => {
      await client.deleteTrigger(triggerId);
      return { content: [{ type: 'text', text: `Trigger ${triggerId} deleted.` }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_SYNC,
    {
      description:
        'Declaratively sync triggers from a flow definition — reconciles trigger registrations against the nodes present in the supplied definition. Refreshes the cron scheduler.',
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        definition: z
          .object({
            nodes: z.array(z.unknown()),
            edges: z.array(z.unknown()).optional(),
          })
          .passthrough()
          .describe('The flow definition (at minimum: { nodes, edges? })'),
      },
    },
    async ({ flowId, definition }) => {
      const triggers = await client.syncTriggers(flowId, definition);
      return { content: [{ type: 'text', text: mapTriggerList(triggers) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_EXECUTE_CRON,
    {
      description:
        'Manually fire a cron trigger (starts a flow run off-schedule). Useful for testing or one-off runs.',
      inputSchema: { triggerId: z.string().describe('The cron trigger ID to fire') },
    },
    async ({ triggerId }) => {
      const result = await client.executeCronTrigger(triggerId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.TRIGGER_LIST_ENABLED_CRON,
    {
      description: 'List all enabled cron triggers across all flows (diagnostic view).',
      inputSchema: {},
    },
    async () => {
      const triggers = await client.listEnabledCronTriggers();
      return { content: [{ type: 'text', text: mapTriggerList(triggers) }] };
    },
  );
}
