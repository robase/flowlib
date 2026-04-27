/**
 * grafana.create_annotation — Create a Grafana annotation
 *
 * Creates an annotation on a dashboard or globally. Annotations are
 * visual markers on graphs useful for marking deployments, incidents,
 * or other events. Requires a Grafana service account token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GRAFANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Grafana credential is required'),
  baseUrl: z.string().url('A valid Grafana instance URL is required'),
  text: z.string().min(1, 'Annotation text is required'),
  dashboardUid: z.string().optional().default(''),
  panelId: z.number().int().optional(),
  tags: z.string().optional().default(''),
  time: z.number().int().optional(),
  timeEnd: z.number().int().optional(),
});

export const grafanaCreateAnnotationAction = defineAction({
  id: 'grafana.create_annotation',
  name: 'Create Annotation',
  description:
    'Create a Grafana annotation (POST /api/annotations). Use when the user wants to mark a deployment, incident, or noteworthy event on dashboards.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"message": "Annotation added", "id": 1}\n' +
    '```',
  provider: GRAFANA_PROVIDER,
  actionCategory: 'write',

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
        name: 'text',
        label: 'Annotation Text',
        type: 'textarea',
        required: true,
        placeholder: 'Deployed v2.1.0 to production',
        description: 'The text content of the annotation',
        aiProvided: true,
      },
      {
        name: 'dashboardUid',
        label: 'Dashboard UID',
        type: 'text',
        placeholder: 'e.g. abc123def',
        description: 'UID of the dashboard. Leave empty for a global annotation.',
        aiProvided: true,
      },
      {
        name: 'panelId',
        label: 'Panel ID',
        type: 'number',
        description: 'Numeric panel ID. Requires dashboardUid to be set.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'tags',
        label: 'Tags',
        type: 'text',
        placeholder: 'deploy, production',
        description: 'Comma-separated tags for the annotation.',
        aiProvided: true,
      },
      {
        name: 'time',
        label: 'Start Time (epoch ms)',
        type: 'number',
        description: 'Start time in epoch milliseconds. Defaults to now.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'timeEnd',
        label: 'End Time (epoch ms)',
        type: 'number',
        description: 'End time in epoch ms for a region annotation. Omit for a point annotation.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['grafana', 'annotation', 'create', 'deploy', 'monitoring', 'observability'],

  async execute(params, context) {
    const { credentialId, baseUrl, text, dashboardUid, panelId, tags, time, timeEnd } = params;

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

    context.logger.debug('Creating Grafana annotation', { dashboardUid, text });

    const body: Record<string, unknown> = { text };
    if (dashboardUid) {
      body.dashboardUID = dashboardUid;
    }
    if (panelId !== undefined) {
      body.panelId = panelId;
    }
    if (tags) {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (parsedTags.length > 0) {
        body.tags = parsedTags;
      }
    }
    if (time !== undefined) {
      body.time = time;
    }
    if (timeEnd !== undefined) {
      body.timeEnd = timeEnd;
    }

    try {
      const response = await fetch(`${baseUrl}/api/annotations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Grafana API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        id: number;
        message: string;
      };

      return {
        success: true,
        output: {
          id: result.id,
          message: result.message,
          text,
          dashboardUid: dashboardUid || null,
          panelId: panelId ?? null,
          tags: tags ?? [],
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to create Grafana annotation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
