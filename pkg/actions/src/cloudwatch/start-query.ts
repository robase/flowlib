/**
 * cloudwatch.start_query — Start a CloudWatch Logs Insights query
 *
 * Starts a CloudWatch Logs Insights query against one or more log groups.
 * Returns a queryId that can be used with cloudwatch.get_query_results to
 * poll for results. Requires AWS credentials (access key + secret key).
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_StartQuery.html
 */

import { defineAction } from '@flowlib/action-kit';
import { CLOUDWATCH_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'AWS credential is required'),
  region: z.string().min(1, 'AWS region is required'),
  logGroupNames: z.string().min(1, 'At least one log group name is required'),
  queryString: z.string().min(1, 'Query string is required'),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().optional().default(''),
  limit: z.number().int().min(1).max(10000).optional().default(100),
});

/**
 * Sign and execute a request to the CloudWatch Logs API using AWS SigV4.
 * This is a minimal implementation that avoids a dependency on the full AWS SDK.
 */
async function cwLogsRequest(
  action: string,
  body: Record<string, unknown>,
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
): Promise<Response> {
  const host = `logs.${region}.amazonaws.com`;
  const url = `https://${host}/`;
  const bodyStr = JSON.stringify(body);

  // Minimal AWS SigV4 signing
  const encoder = new TextEncoder();
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const service = 'logs';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  // Hash helpers using Web Crypto
  async function sha256(data: Uint8Array | string): Promise<ArrayBuffer> {
    const input = typeof data === 'string' ? encoder.encode(data) : data;
    return crypto.subtle.digest('SHA-256', input);
  }

  async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  }

  function toHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const payloadHash = toHex(await sha256(bodyStr));

  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:Logs_20140328.${action}\n`;

  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    toHex(await sha256(canonicalRequest)),
  ].join('\n');

  // Derive signing key
  const kDate = await hmacSha256(
    encoder.encode(`AWS4${secretAccessKey}`).buffer as ArrayBuffer,
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');

  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': `Logs_20140328.${action}`,
      Authorization: authHeader,
      Host: host,
    },
    body: bodyStr,
  });
}

export const cloudwatchStartQueryAction = defineAction({
  id: 'cloudwatch.start_query',
  name: 'Start Log Insights Query',
  description:
    'Start a CloudWatch Logs Insights query (StartQuery). Use when the user wants to search or analyze logs across one or more log groups. ' +
    'Call with comma-separated `logGroupNames`, a Logs Insights `queryString`, and a `startTime` (ISO 8601 or Unix epoch seconds); `endTime` defaults to now. ' +
    'Returns a queryId — poll with cloudwatch.get_query_results until status is "Complete".\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"queryId": "12ab3456-12ab-123a-789e-1234567890ab"}\n' +
    '```',
  provider: CLOUDWATCH_PROVIDER,
  actionCategory: 'read',
  tags: ['aws', 'cloudwatch', 'logs', 'insights', 'query', 'start', 'monitoring', 'observability'],

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
        description: 'AWS region where the log groups reside (e.g. us-east-1, eu-west-1)',
        aiProvided: true,
      },
      {
        name: 'logGroupNames',
        label: 'Log Group Names',
        type: 'text',
        required: true,
        placeholder: '/aws/lambda/my-function, /aws/ecs/my-service',
        description: 'Comma-separated list of CloudWatch log group names to query.',
        aiProvided: true,
      },
      {
        name: 'queryString',
        label: 'Query',
        type: 'code',
        required: true,
        placeholder: 'fields @timestamp, @message | sort @timestamp desc | limit 20',
        description: 'CloudWatch Logs Insights query string. Uses the Logs Insights query syntax.',
        aiProvided: true,
      },
      {
        name: 'startTime',
        label: 'Start Time',
        type: 'text',
        required: true,
        placeholder: '2025-04-06T00:00:00Z',
        description: 'Query start time as ISO 8601 string or Unix epoch seconds. Required.',
        aiProvided: true,
      },
      {
        name: 'endTime',
        label: 'End Time',
        type: 'text',
        placeholder: '2025-04-07T00:00:00Z',
        description: 'Query end time as ISO 8601 string or Unix epoch seconds. Defaults to now.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 100,
        description: 'Maximum number of log events to return (1–10000).',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, region, logGroupNames, queryString, startTime, endTime, limit } = params;

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

    context.logger.debug('Starting CloudWatch Logs Insights query', { region, logGroupNames });

    try {
      const logGroups = logGroupNames
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);

      const parseTime = (t: string): number => {
        if (/^\d+$/.test(t)) {
          return Number(t);
        }
        const d = new Date(t);
        if (isNaN(d.getTime())) {
          throw new Error(`Invalid time: ${t}`);
        }
        return Math.floor(d.getTime() / 1000);
      };

      const startEpoch = parseTime(startTime);
      const endEpoch = endTime?.trim() ? parseTime(endTime) : Math.floor(Date.now() / 1000);

      const body: Record<string, unknown> = {
        logGroupNames: logGroups,
        queryString,
        startTime: startEpoch,
        endTime: endEpoch,
        limit,
      };

      const response = await cwLogsRequest(
        'StartQuery',
        body,
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

      const data = (await response.json()) as { queryId: string };

      return {
        success: true,
        output: { queryId: data.queryId },
        metadata: { region, logGroups, queryId: data.queryId },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `CloudWatch start query failed: ${msg}` };
    }
  },
});

export { cwLogsRequest };
