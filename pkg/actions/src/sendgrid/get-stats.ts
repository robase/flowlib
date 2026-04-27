/**
 * sendgrid.get_stats — Retrieve email sending statistics
 *
 * Fetches global email statistics (requests, delivered, opens, clicks,
 * bounces, spam reports, etc.) for a date range.
 *
 * @see https://www.twilio.com/docs/sendgrid/api-reference/stats/retrieve-global-email-statistics
 */

import { defineAction } from '@flowlib/action-kit';
import { SENDGRID_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'SendGrid credential is required'),
  baseUrl: z.string().optional().default('https://api.sendgrid.com'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional().default(''),
  aggregatedBy: z.enum(['day', 'week', 'month']).optional().default('day'),
});

export const sendgridGetStatsAction = defineAction({
  id: 'sendgrid.get_stats',
  name: 'Get Email Stats',
  description:
    'Retrieve global email sending statistics (GET /v3/stats). Call with `startDate` (YYYY-MM-DD, required), optional `endDate`, and `aggregatedBy` (day/week/month). Use when the user wants to analyze email performance metrics over a date range — requests, deliveries, opens, clicks, bounces, spam reports, and unique counts.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"date": "2024-01-01", "stats": [{"metrics": {"requests": 100, "delivered": 98, "opens": 45, "unique_opens": 30, "clicks": 12, "bounces": 2, "spam_reports": 0}}]}]\n' +
    '```',
  provider: SENDGRID_PROVIDER,
  actionCategory: 'read',
  tags: ['sendgrid', 'email', 'stats', 'analytics', 'metrics', 'reporting'],

  credential: {
    required: true,
    description: 'SendGrid API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'SendGrid Credential',
        type: 'text',
        required: true,
        description: 'SendGrid API key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'baseUrl',
        label: 'API Base URL',
        type: 'text',
        required: false,
        defaultValue: 'https://api.sendgrid.com',
        description: 'SendGrid API base URL',
        extended: true,
        aiProvided: false,
      },
      {
        name: 'startDate',
        label: 'Start Date',
        type: 'text',
        required: true,
        placeholder: '2024-01-01',
        description: 'Start date in YYYY-MM-DD format',
        aiProvided: true,
      },
      {
        name: 'endDate',
        label: 'End Date',
        type: 'text',
        required: false,
        placeholder: '2024-01-31',
        description: 'End date in YYYY-MM-DD format. Defaults to today.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'aggregatedBy',
        label: 'Aggregated By',
        type: 'select',
        required: false,
        defaultValue: 'day',
        description: 'How to group the statistics',
        options: [
          { label: 'Day', value: 'day' },
          { label: 'Week', value: 'week' },
          { label: 'Month', value: 'month' },
        ],
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, baseUrl, startDate, endDate, aggregatedBy } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a SendGrid API key credential.`,
      };
    }

    const apiKey = (credential.config?.apiKey as string) ?? (credential.config?.token as string);
    if (!apiKey) {
      return {
        success: false,
        error: 'No API key found in credential. Please add a SendGrid API key.',
      };
    }

    const apiBase = baseUrl || 'https://api.sendgrid.com';
    const queryParams = new URLSearchParams();
    queryParams.set('start_date', startDate);
    if (endDate) {
      queryParams.set('end_date', endDate);
    }
    if (aggregatedBy) {
      queryParams.set('aggregated_by', aggregatedBy);
    }

    const url = `${apiBase}/v3/stats?${queryParams.toString()}`;

    context.logger.debug('Fetching SendGrid email stats', { startDate, endDate, aggregatedBy });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'flowlib/1.0',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `SendGrid API error ${response.status}: ${errorBody}` };
      }

      const stats = (await response.json()) as unknown[];

      return {
        success: true,
        output: {
          stats,
          count: Array.isArray(stats) ? stats.length : 0,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to fetch SendGrid stats: ${message}` };
    }
  },
});
