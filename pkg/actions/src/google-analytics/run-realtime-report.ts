/**
 * google_analytics.run_realtime_report — Run a GA4 realtime report
 *
 * Runs a realtime report against a Google Analytics 4 property.
 * Returns current active users and live metrics.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_ANALYTICS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Analytics credential is required'),
  propertyId: z.string().min(1, 'GA4 property ID is required'),
  metrics: z.string().min(1, 'At least one metric is required'),
  dimensions: z.string().optional().default(''),
  limit: z.number().int().min(1).max(100000).optional().default(100),
});

export const googleAnalyticsRunRealtimeReportAction = defineAction({
  id: 'google_analytics.run_realtime_report',
  name: 'Run Realtime Report',
  description:
    'Run a GA4 realtime report (properties.runRealtimeReport). Use when the user wants to see live metrics from the last 30 minutes, like current active users or real-time page views. ' +
    'Call with `propertyId` and comma-separated `metrics` (e.g. activeUsers, screenPageViews, conversions). ' +
    'Optional `dimensions` (e.g. city, country, unifiedScreenName) for grouping.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"metricHeaders": [{"name": "activeUsers"}], "rows": [{"metricValues": [{"value": "42"}]}], "rowCount": 1}\n' +
    '```',
  provider: GOOGLE_ANALYTICS_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    description: 'Google OAuth2 credential with Analytics read-only scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Credential',
        type: 'text',
        required: true,
        description: 'Google OAuth2 credential with Analytics read-only scope',
        aiProvided: false,
      },
      {
        name: 'propertyId',
        label: 'Property ID',
        type: 'text',
        required: true,
        placeholder: '123456789',
        description: 'GA4 property ID (numeric, without "properties/" prefix)',
        aiProvided: false,
      },
      {
        name: 'metrics',
        label: 'Metrics',
        type: 'text',
        required: true,
        placeholder: 'activeUsers,screenPageViews',
        description: 'Comma-separated realtime metric names',
        aiProvided: true,
      },
      {
        name: 'dimensions',
        label: 'Dimensions',
        type: 'text',
        placeholder: 'city,country,unifiedScreenName',
        description: 'Comma-separated realtime dimension names (optional)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Row Limit',
        type: 'number',
        defaultValue: 100,
        description: 'Maximum number of rows to return (1–100,000)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'analytics', 'ga4', 'realtime', 'live', 'oauth2'],

  async execute(params, context) {
    const { credentialId, propertyId, metrics, dimensions, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Running GA4 realtime report', { propertyId, metrics });

    try {
      const metricsArray = metrics.split(',').map((m) => ({ name: m.trim() }));
      const dimensionsArray = dimensions
        ? dimensions
            .split(',')
            .filter((d) => d.trim())
            .map((d) => ({ name: d.trim() }))
        : undefined;

      const body: Record<string, unknown> = {
        metrics: metricsArray,
        limit,
      };
      if (dimensionsArray && dimensionsArray.length > 0) {
        body.dimensions = dimensionsArray;
      }

      const url = `${GA_DATA_API}/properties/${propertyId}:runRealtimeReport`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GA4 Realtime API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        dimensionHeaders?: Array<{ name: string }>;
        metricHeaders?: Array<{ name: string; type: string }>;
        rows?: Array<{
          dimensionValues?: Array<{ value: string }>;
          metricValues?: Array<{ value: string }>;
        }>;
        rowCount?: number;
      };

      return {
        success: true,
        output: {
          dimensionHeaders: data.dimensionHeaders ?? [],
          metricHeaders: data.metricHeaders ?? [],
          rows: data.rows ?? [],
          rowCount: data.rowCount ?? data.rows?.length ?? 0,
        },
        metadata: { rowCount: data.rowCount ?? data.rows?.length ?? 0 },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GA4 realtime report failed: ${msg}` };
    }
  },
});
