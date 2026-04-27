/**
 * grafana.get_dashboard — Retrieve a Grafana dashboard by UID
 *
 * Returns the full dashboard model including panels, variables,
 * annotations, and metadata. Requires a Grafana service account token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GRAFANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Grafana credential is required'),
  baseUrl: z.string().url('A valid Grafana instance URL is required'),
  dashboardUid: z.string().min(1, 'Dashboard UID is required'),
});

export const grafanaGetDashboardAction = defineAction({
  id: 'grafana.get_dashboard',
  name: 'Get Dashboard',
  description:
    'Retrieve a Grafana dashboard by UID (GET /api/dashboards/uid/{uid}). Use when the user wants to inspect dashboard panels, variables, or metadata.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"uid": "abc123", "title": "Production Overview", "tags": ["prod"], "version": 3, "url": "/d/abc123/production-overview", "panels": [{"id": 1, "type": "timeseries", "title": "CPU Usage"}]}\n' +
    '```',
  provider: GRAFANA_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'api_key',
    description: 'Grafana service account token or API key',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Grafana Credential',
        type: 'text',
        required: true,
        description: 'Grafana service account token or API key for authentication',
        aiProvided: false,
      },
      {
        name: 'baseUrl',
        label: 'Grafana URL',
        type: 'text',
        required: true,
        placeholder: 'https://your-instance.grafana.net',
        description: 'Base URL of the Grafana instance (no trailing slash)',
        aiProvided: true,
      },
      {
        name: 'dashboardUid',
        label: 'Dashboard UID',
        type: 'text',
        required: true,
        placeholder: 'e.g. abc123def',
        description: 'The UID of the dashboard to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['grafana', 'dashboard', 'get', 'monitoring', 'observability'],

  async execute(params, context) {
    const { credentialId, baseUrl, dashboardUid } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Grafana credential.`,
      };
    }

    const token =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!token) {
      return {
        success: false,
        error: 'No valid token in credential. Please provide a Grafana service account token.',
      };
    }

    context.logger.debug('Retrieving Grafana dashboard', { dashboardUid });

    try {
      const response = await fetch(
        `${baseUrl}/api/dashboards/uid/${encodeURIComponent(dashboardUid)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Grafana API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        dashboard: {
          id: number;
          uid: string;
          title: string;
          description?: string;
          tags: string[];
          timezone: string;
          schemaVersion: number;
          version: number;
          panels: Array<{
            id: number;
            type: string;
            title: string;
            description?: string;
            gridPos: { h: number; w: number; x: number; y: number };
          }>;
          templating?: { list: Array<{ name: string; type: string; query: unknown }> };
          annotations?: { list: Array<{ name: string; datasource: unknown }> };
        };
        meta: {
          slug: string;
          url: string;
          folderUid?: string;
          folderTitle?: string;
          created: string;
          updated: string;
          createdBy: string;
          updatedBy: string;
          version: number;
        };
      };

      return {
        success: true,
        output: {
          uid: data.dashboard.uid,
          title: data.dashboard.title,
          description: data.dashboard.description ?? null,
          tags: data.dashboard.tags,
          version: data.meta.version,
          url: data.meta.url,
          folderUid: data.meta.folderUid ?? null,
          folderTitle: data.meta.folderTitle ?? null,
          created: data.meta.created,
          updated: data.meta.updated,
          panelCount: data.dashboard.panels?.length ?? 0,
          panels: (data.dashboard.panels ?? []).map((p) => ({
            id: p.id,
            type: p.type,
            title: p.title,
            description: p.description ?? null,
          })),
          variables: (data.dashboard.templating?.list ?? []).map((v) => ({
            name: v.name,
            type: v.type,
          })),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to retrieve Grafana dashboard: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
