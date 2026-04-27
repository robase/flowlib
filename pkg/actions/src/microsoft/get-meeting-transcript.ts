/**
 * microsoft.get_meeting_transcript — Get transcript for a Teams meeting
 *
 * Lists transcripts for an online meeting and retrieves the content of the
 * most recent (or specified) transcript. Returns the transcript as plain text.
 *
 * Requires a Microsoft 365 OAuth2 credential with
 * OnlineMeetingTranscript.Read.All scope.
 *
 * Flow: list transcripts → pick one → fetch content as text/vtt → return.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphTranscript {
  id: string;
  meetingId: string;
  meetingOrganizerId: string;
  createdDateTime: string;
  transcriptContentUrl: string;
}

interface GraphTranscriptsResponse {
  value: GraphTranscript[];
  '@odata.nextLink'?: string;
}

/**
 * Parse a WebVTT transcript into an array of speaker-attributed segments.
 * Falls back to raw text if parsing fails.
 */
function parseVttTranscript(
  vttContent: string,
): Array<{ speaker: string; text: string; timestamp: string }> {
  const lines = vttContent.split('\n');
  const segments: Array<{ speaker: string; text: string; timestamp: string }> = [];

  let currentTimestamp = '';
  let currentSpeaker = '';
  let currentText = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header and empty lines
    if (!trimmed || trimmed === 'WEBVTT' || trimmed.startsWith('NOTE')) {
      continue;
    }

    // Timestamp line: "00:00:00.000 --> 00:00:05.000"
    const timestampMatch = trimmed.match(
      /^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/,
    );
    if (timestampMatch) {
      // Save previous segment if any
      if (currentText) {
        segments.push({
          speaker: currentSpeaker || 'Unknown',
          text: currentText.trim(),
          timestamp: currentTimestamp,
        });
      }
      currentTimestamp = `${timestampMatch[1]} → ${timestampMatch[2]}`;
      currentText = '';
      currentSpeaker = '';
      continue;
    }

    // Speaker tag: "<v Speaker Name>text</v>" or just text
    const speakerMatch = trimmed.match(/^<v\s+([^>]+)>(.*)$/);
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1];
      currentText += speakerMatch[2].replace(/<\/v>/g, '') + ' ';
    } else if (currentTimestamp) {
      // Continuation text
      currentText += trimmed.replace(/<\/v>/g, '') + ' ';
    }
  }

  // Push last segment
  if (currentText) {
    segments.push({
      speaker: currentSpeaker || 'Unknown',
      text: currentText.trim(),
      timestamp: currentTimestamp,
    });
  }

  return segments;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
  meetingId: z.string().min(1, 'Online meeting ID is required'),
  transcriptId: z.string().optional().default(''),
  format: z.enum(['parsed', 'raw']).optional().default('parsed'),
});

export const microsoftGetMeetingTranscriptAction = defineAction({
  id: 'microsoft.get_meeting_transcript',
  name: 'Get Meeting Transcript',
  description:
    'Get the transcript for a Teams online meeting (GET /me/onlineMeetings/{id}/transcripts/{id}/content). Use when you need meeting notes, action items, or a written record of what was discussed.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"meetingId": "MSo1N2Y5...", "transcriptId": "MSMjMCMj...", "segmentCount": 42, "segments": [{"speaker": "Alice", "text": "Let\'s review the Q1 numbers.", "timestamp": "00:00:16.246 → 00:00:17.726"}]}\n' +
    '```',
  provider: MICROSOFT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['OnlineMeetingTranscript.Read.All'],
    description: 'Microsoft 365 OAuth2 credential with OnlineMeetingTranscript.Read.All scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Microsoft 365 Credential',
        type: 'text',
        required: true,
        description: 'Microsoft 365 OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'meetingId',
        label: 'Meeting ID',
        type: 'text',
        required: true,
        placeholder: 'MSo1N2Y5ZGFjYy03MWJm...',
        description:
          'The online meeting ID (from list_online_meetings or a calendar event with isOnlineMeeting=true)',
        aiProvided: true,
      },
      {
        name: 'transcriptId',
        label: 'Transcript ID',
        type: 'text',
        placeholder: 'Leave empty for the most recent transcript',
        description: 'Specific transcript ID. If omitted, the most recent transcript is retrieved.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'format',
        label: 'Output Format',
        type: 'select',
        defaultValue: 'parsed',
        options: [
          { label: 'Parsed (speaker segments)', value: 'parsed' },
          { label: 'Raw VTT', value: 'raw' },
        ],
        description: 'How to return the transcript content',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'teams', 'meeting', 'transcript', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId, meetingId, transcriptId, format } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken = credential.config?.accessToken as string;
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Getting meeting transcript', { meetingId, transcriptId });

    try {
      const meetingBase = `${GRAPH_API_BASE}/me/onlineMeetings/${encodeURIComponent(meetingId)}`;

      // Step 1: Resolve transcript ID
      let resolvedTranscriptId = transcriptId?.trim() || '';

      if (!resolvedTranscriptId) {
        // List transcripts and pick the most recent
        const listUrl = `${meetingBase}/transcripts?$orderby=createdDateTime desc&$top=1`;
        const listResp = await fetch(listUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!listResp.ok) {
          const errorText = await listResp.text();
          return {
            success: false,
            error: `Failed to list transcripts: ${listResp.status} - ${errorText}`,
          };
        }

        const listData = (await listResp.json()) as GraphTranscriptsResponse;
        if (!listData.value || listData.value.length === 0) {
          return {
            success: false,
            error: 'No transcripts found for this meeting. Ensure transcription was enabled.',
          };
        }

        resolvedTranscriptId = listData.value[0].id;
      }

      // Step 2: Fetch transcript content as VTT
      const contentUrl = `${meetingBase}/transcripts/${encodeURIComponent(resolvedTranscriptId)}/content?$format=text/vtt`;
      const contentResp = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'text/vtt',
        },
      });

      if (!contentResp.ok) {
        const errorText = await contentResp.text();
        return {
          success: false,
          error: `Failed to fetch transcript content: ${contentResp.status} - ${errorText}`,
        };
      }

      const vttContent = await contentResp.text();

      if (format === 'raw') {
        return {
          success: true,
          output: {
            meetingId,
            transcriptId: resolvedTranscriptId,
            format: 'vtt',
            content: vttContent,
          },
          metadata: { meetingId, transcriptId: resolvedTranscriptId },
        };
      }

      // Parse VTT into structured segments
      const segments = parseVttTranscript(vttContent);

      return {
        success: true,
        output: {
          meetingId,
          transcriptId: resolvedTranscriptId,
          segments,
          segmentCount: segments.length,
          speakers: [...new Set(segments.map((s) => s.speaker))],
        },
        metadata: {
          meetingId,
          transcriptId: resolvedTranscriptId,
          segmentCount: segments.length,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph operation failed: ${msg}` };
    }
  },
});
