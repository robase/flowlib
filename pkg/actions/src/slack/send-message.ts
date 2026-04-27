/**
 * slack.send_message — Post a message to a Slack channel
 *
 * Sends a text message to a Slack channel or DM using the Slack Web API.
 * Supports Markdown-like formatting (mrkdwn), thread replies, and unfurling control.
 * Requires a Slack OAuth2 credential with chat:write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { SLACK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SLACK_API_BASE = 'https://slack.com/api';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Slack credential is required'),
  channel: z.string().min(1, 'Channel is required'),
  text: z.string().min(1, 'Message text is required'),
  threadTs: z.string().optional().default(''),
  unfurlLinks: z.boolean().optional().default(true),
  unfurlMedia: z.boolean().optional().default(true),
});

export const slackSendMessageAction = defineAction({
  id: 'slack.send_message',
  name: 'Send Message',
  description:
    'Send a message to a Slack channel or DM (chat.postMessage). Use when the user wants to post a message, notification, or reply to a Slack channel. ' +
    'Call with `channel` (channel ID like C01ABC23DEF or name with #), `text` (supports mrkdwn formatting), and optionally `threadTs` to reply in a thread.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"ok": true, "channel": "C01ABC23DEF", "ts": "1503435956.000247", "message": {"text": "Hello!", "type": "message", "subtype": "bot_message"}}\n' +
    '```',
  provider: SLACK_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'slack',
    requiredScopes: ['chat:write'],
    description: 'Slack OAuth2 credential with chat:write scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Slack Credential',
        type: 'text',
        required: true,
        description: 'Slack OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'channel',
        label: 'Channel',
        type: 'text',
        required: true,
        placeholder: '#general or C01ABC23DEF',
        description: "Channel name (with #) or channel ID. For DMs, use the user's DM channel ID.",
        aiProvided: true,
      },
      {
        name: 'text',
        label: 'Message',
        type: 'textarea',
        required: true,
        placeholder: 'Hello from Flowlib! :wave:',
        description: 'Message text. Supports Slack mrkdwn formatting (*bold*, _italic_, `code`).',
        aiProvided: true,
      },
      {
        name: 'threadTs',
        label: 'Thread Timestamp',
        type: 'text',
        description: "Reply to a specific thread by providing the parent message's ts value",
        extended: true,
        aiProvided: true,
      },
      {
        name: 'unfurlLinks',
        label: 'Unfurl Links',
        type: 'boolean',
        defaultValue: true,
        description: 'Enable or disable link previews',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'unfurlMedia',
        label: 'Unfurl Media',
        type: 'boolean',
        defaultValue: true,
        description: 'Enable or disable media previews',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['slack', 'messaging', 'chat', 'communication', 'oauth2'],

  async execute(params, context) {
    const { credentialId, channel, text, threadTs, unfurlLinks, unfurlMedia } = params;

    // Resolve credential
    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Slack OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Slack credential.',
      };
    }

    context.logger.debug('Sending Slack message', { channel, hasThread: !!threadTs });

    try {
      const body: Record<string, unknown> = {
        channel,
        text,
        unfurl_links: unfurlLinks,
        unfurl_media: unfurlMedia,
      };

      if (threadTs) {
        body.thread_ts = threadTs;
      }

      const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
        channel?: string;
        ts?: string;
        message?: { text?: string; ts?: string };
      };

      if (!data.ok) {
        return {
          success: false,
          error: `Slack API error: ${data.error ?? 'unknown error'}`,
        };
      }

      return {
        success: true,
        output: {
          channel: data.channel,
          ts: data.ts,
          messageText: data.message?.text,
        },
        metadata: {
          channel: data.channel,
          ts: data.ts,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Slack send failed: ${msg}` };
    }
  },
});
