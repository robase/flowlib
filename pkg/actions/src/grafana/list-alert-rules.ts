/**
 * grafana.list_alert_rules — List Grafana alert rules
 *
 * Returns all alert rules organized by folder and group, including
 * rule name, condition, state, labels, and evaluation interval.
 * Requires a Grafana service account token with alert rule read permissions.
 */

import { defineAction } from '@flowlib/action-kit';
import { GRAFANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Grafana credential is required'),
  baseUrl: z.string().url('A valid Grafana instance URL is required'),
});

export const grafanaListAlertRulesAction = defineAction({
  id: 'grafana.list_alert_rules',
  name: 'List Alert Rules',
  description:
    'List all Grafana alert rules (GET /api/v1/provisioning/alert-rules). Use when the user wants to audit alerting configuration, check paused rules, or review alert conditions.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"rules": [{"uid": "abc123", "title": "High CPU", "folderUid": "folder1", "ruleGroup": "infra", "condition": "B", "for": "5m", "isPaused": false}], "totalCount": 12}\n' +
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

  tags: ['grafana', 'alert', 'rules', 'list', 'monitoring', 'observability'],

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

    context.logger.debug('Listing Grafana alert rules');

    try {
      const response = await fetch(`${baseUrl}/api/v1/provisioning/alert-rules`, {
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

      const rules = (await response.json()) as Array<{
        uid: string;
        title: string;
        orgID: number;
        folderUID: string;
        ruleGroup: string;
        condition: string;
        noDataState: string;
        execErrState: string;
        for: string;
        isPaused: boolean;
        labels: Record<string, string>;
        annotations: Record<string, string>;
      }>;

      return {
        success: true,
        output: {
          rules: rules.map((r) => ({
            uid: r.uid,
            title: r.title,
            folderUid: r.folderUID,
            ruleGroup: r.ruleGroup,
            condition: r.condition,
            noDataState: r.noDataState,
            execErrState: r.execErrState,
            for: r.for,
            isPaused: r.isPaused,
            labels: r.labels,
            annotations: r.annotations,
          })),
          totalCount: rules.length,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to list Grafana alert rules: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
