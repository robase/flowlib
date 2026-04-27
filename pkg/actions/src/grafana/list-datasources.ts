/**
 * grafana.list_datasources — List all datasources in a Grafana instance
 *
 * Returns metadata for every configured datasource including name, type,
 * URL, database, and access mode. Requires a Grafana service account token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GRAFANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Grafana credential is required'),
  baseUrl: z.string().url('A valid Grafana instance URL is required'),
});

export const grafanaListDatasourcesAction = defineAction({
  id: 'grafana.list_datasources',
  name: 'List Datasources',
  description:
    'List all datasources in a Grafana instance (GET /api/datasources). Use when the user wants to see configured data connections or find a datasource UID.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"datasources": [{"uid": "H8joYFVGz", "name": "Prometheus", "type": "prometheus", "url": "http://prometheus:9090", "isDefault": true}], "totalCount": 3}\n' +
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
    ],
  },

  tags: ['grafana', 'datasource', 'list', 'monitoring', 'observability'],

  async execute(params, context) {
    const { credentialId, baseUrl } = params;

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

    context.logger.debug('Listing Grafana datasources');

    try {
      const response = await fetch(`${baseUrl}/api/datasources`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Grafana API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const datasources = (await response.json()) as Array<{
        id: number;
        uid: string;
        name: string;
        type: string;
        typeName: string;
        url: string;
        database: string;
        access: string;
        isDefault: boolean;
        readOnly: boolean;
      }>;

      return {
        success: true,
        output: {
          datasources: datasources.map((ds) => ({
            uid: ds.uid,
            name: ds.name,
            type: ds.type,
            typeName: ds.typeName,
            url: ds.url,
            database: ds.database,
            access: ds.access,
            isDefault: ds.isDefault,
            readOnly: ds.readOnly,
          })),
          totalCount: datasources.length,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to list Grafana datasources: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
