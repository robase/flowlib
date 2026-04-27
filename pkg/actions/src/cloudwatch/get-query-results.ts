/**
 * cloudwatch.get_query_results — Get CloudWatch Logs Insights query results
 *
 * Polls for the results of a previously started Logs Insights query.
 * The query may still be running — check the "status" field in the response.
 * Requires AWS credentials (access key + secret key).
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_GetQueryResults.html
 */

import { defineAction } from '@flowlib/action-kit';
import { CLOUDWATCH_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import { cwLogsRequest } from './start-query';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'AWS credential is required'),
  region: z.string().min(1, 'AWS region is required'),
  queryId: z.string().min(1, 'Query ID is required'),
});

export const cloudwatchGetQueryResultsAction = defineAction({
  id: 'cloudwatch.get_query_results',
  name: 'Get Query Results',
  description:
    'Get results for a CloudWatch Logs Insights query (GetQueryResults). Use after cloudwatch.start_query to poll for log query results. ' +
    'Call with the `queryId` returned from start_query. Check `status` — possible values: Running, Scheduled, Complete, Failed, Cancelled, Timeout, Unknown.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"status": "Complete", "results": [{"@timestamp": "2025-04-07 08:00:00", "@message": "INFO: request processed"}], "resultCount": 1, "statistics": {"recordsMatched": 150, "recordsScanned": 5000}}\n' +
    '```',
  provider: CLOUDWATCH_PROVIDER,
  actionCategory: 'read',
  tags: ['aws', 'cloudwatch', 'logs', 'insights', 'results', 'poll', 'monitoring', 'observability'],

  credential: {
    required: true,
    type: 'api_key',
    description: 'AWS credential with CloudWatch Logs read access (accessKeyId + secretAccessKey)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'AWS Credential',
        type: 'text',
        required: true,
        description: 'AWS credential containing accessKeyId and secretAccessKey',
        aiProvided: false,
      },
      {
        name: 'region',
        label: 'AWS Region',
        type: 'text',
        required: true,
        placeholder: 'us-east-1',
        description: 'AWS region where the query was started',
        aiProvided: true,
      },
      {
        name: 'queryId',
        label: 'Query ID',
        type: 'text',
        required: true,
        placeholder: '12ab3456-12ab-123a-789e-1234567890ab',
        description: 'The queryId returned from cloudwatch.start_query.',
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, region, queryId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create an AWS credential with accessKeyId and secretAccessKey.`,
      };
    }

    const accessKeyId =
      (credential.config?.accessKeyId as string) ?? (credential.config?.accessToken as string);
    const secretAccessKey = credential.config?.secretAccessKey as string;

    if (!accessKeyId || !secretAccessKey) {
      return {
        success: false,
        error: 'AWS credential must contain accessKeyId and secretAccessKey fields.',
      };
    }

    context.logger.debug('Getting CloudWatch Logs Insights query results', { region, queryId });

    try {
      const response = await cwLogsRequest(
        'GetQueryResults',
        { queryId },
        region,
        accessKeyId,
        secretAccessKey,
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `CloudWatch Logs API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        status: string;
        results: Array<Array<{ field: string; value: string }>>;
        statistics: {
          recordsMatched: number;
          recordsScanned: number;
          bytesScanned: number;
        };
      };

      // Convert array-of-arrays into array-of-objects for easier consumption
      const rows = data.results.map((row) => {
        const obj: Record<string, string> = {};
        for (const field of row) {
          obj[field.field] = field.value;
        }
        return obj;
      });

      return {
        success: true,
        output: {
          status: data.status,
          results: rows,
          resultCount: rows.length,
          statistics: data.statistics,
        },
        metadata: {
          queryId,
          status: data.status,
          recordsMatched: data.statistics?.recordsMatched,
          recordsScanned: data.statistics?.recordsScanned,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `CloudWatch get query results failed: ${msg}` };
    }
  },
});
