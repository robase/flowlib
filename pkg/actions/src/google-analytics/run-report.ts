/**
 * google_analytics.run_report — Run a GA4 report
 *
 * Runs a report against a Google Analytics 4 property using the Data API.
 * Returns rows of dimensions and metrics for the specified date range.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_ANALYTICS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Analytics credential is required'),
  propertyId: z.string().min(1, 'GA4 property ID is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  metrics: z.string().min(1, 'At least one metric is required'),
  dimensions: z.string().optional().default(''),
  limit: z.number().int().min(1).max(100000).optional().default(100),
});

export const googleAnalyticsRunReportAction = defineAction({
  id: 'google_analytics.run_report',
  name: 'Run Report',
  description:
    'Run a GA4 report for a property (properties.runReport). Use when the user wants to query historical analytics data like sessions, page views, or user counts. ' +
    'Call with `propertyId`, `startDate`/`endDate` (e.g. "7daysAgo"/"today"), and comma-separated `metrics` (e.g. sessions, activeUsers, screenPageViews, conversions). ' +
    'Optional `dimensions` (e.g. date, city, country, sessionSource, pagePath) for grouping.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"metricHeaders": [{"name": "sessions"}], "rows": [{"dimensionValues": [{"value": "2025-03-15"}], "metricValues": [{"value": "1234"}]}], "rowCount": 7}\n' +
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
        name: 'startDate',
        label: 'Start Date',
        type: 'text',
        required: true,
        placeholder: '7daysAgo',
        description: 'Start date in YYYY-MM-DD format or relative (e.g. "7daysAgo", "30daysAgo")',
        aiProvided: true,
      },
      {
        name: 'endDate',
        label: 'End Date',
        type: 'text',
        required: true,
        placeholder: 'today',
        description: 'End date in YYYY-MM-DD format or relative (e.g. "today", "yesterday")',
        aiProvided: true,
      },
      {
        name: 'metrics',
        label: 'Metrics',
        type: 'text',
        required: true,
        placeholder: 'sessions,activeUsers,screenPageViews',
        description: 'Comma-separated metric names',
        aiProvided: true,
      },
      {
        name: 'dimensions',
        label: 'Dimensions',
        type: 'text',
        placeholder: 'date,city,country',
        description: 'Comma-separated dimension names (optional)',
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

  tags: ['google', 'analytics', 'ga4', 'report', 'metrics', 'oauth2'],

  async execute(params, context) {
    const { credentialId, propertyId, startDate, endDate, metrics, dimensions, limit } = params;

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

    context.logger.debug('Running GA4 report', { propertyId, startDate, endDate, metrics });

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
        dateRanges: [{ startDate, endDate }],
        limit,
      };
      if (dimensionsArray && dimensionsArray.length > 0) {
        body.dimensions = dimensionsArray;
      }

      const url = `${GA_DATA_API}/properties/${propertyId}:runReport`;
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
          error: `GA4 Data API error: ${response.status} - ${errorText}`,
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
      return { success: false, error: `GA4 report failed: ${msg}` };
    }
  },
});
