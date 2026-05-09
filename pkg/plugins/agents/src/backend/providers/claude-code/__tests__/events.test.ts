/**
 * Unit tests for the `SDKMessage` → `AgentEvent` mapper.
 *
 * Fixtures are hand-built to match the real SDK shapes documented in
 * `@anthropic-ai/claude-agent-sdk/sdk.d.ts` — no real network calls.
 */
import { describe, it, expect } from 'vitest';
import {
  mapSdkMessage,
  isFileEditTool,
  extractFileEditPath,
  extractFileEditContents,
  type SdkMessageLike,
} from '../events';

describe('mapSdkMessage', () => {
  describe('assistant messages', () => {
    it('emits a single text-delta for a text content block', () => {
      const msg: SdkMessageLike = {
        type: 'assistant',
        message: {
          id: 'msg_abc',
          content: [{ type: 'text', text: 'Hello world' }],
        },
        parent_tool_use_id: null,
        uuid: 'uuid-1',
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([
        { type: 'text-delta', messageId: 'msg_abc', text: 'Hello world' },
      ]);
    });

    it('emits a tool-call for a tool_use content block', () => {
      const msg: SdkMessageLike = {
        type: 'assistant',
        message: {
          id: 'msg_xyz',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'Read',
              input: { file_path: '/foo.ts' },
            },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'uuid-2',
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([
        {
          type: 'tool-call',
          messageId: 'msg_xyz',
          id: 'toolu_01',
          name: 'Read',
          input: { file_path: '/foo.ts' },
        },
      ]);
    });

    it('emits multiple events for an assistant turn with text + tool_use blocks', () => {
      const msg: SdkMessageLike = {
        type: 'assistant',
        message: {
          id: 'msg_multi',
          content: [
            { type: 'text', text: 'Let me check that file.' },
            {
              type: 'tool_use',
              id: 'toolu_02',
              name: 'Read',
              input: { file_path: '/bar.ts' },
            },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'uuid-3',
      };
      const events = mapSdkMessage(msg);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'text-delta',
        messageId: 'msg_multi',
        text: 'Let me check that file.',
      });
      expect(events[1]).toMatchObject({
        type: 'tool-call',
        messageId: 'msg_multi',
        id: 'toolu_02',
        name: 'Read',
      });
    });

    it('skips empty text blocks', () => {
      const msg: SdkMessageLike = {
        type: 'assistant',
        message: {
          id: 'msg_empty',
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: 'real text' },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'uuid-4',
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([
        { type: 'text-delta', messageId: 'msg_empty', text: 'real text' },
      ]);
    });

    it('falls back to uuid when message.id is missing', () => {
      const msg: SdkMessageLike = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hello' }],
        },
        uuid: 'uuid-fallback',
      };
      const events = mapSdkMessage(msg);
      expect(events[0]).toMatchObject({
        type: 'text-delta',
        messageId: 'uuid-fallback',
      });
    });

    it('drops unknown content block types silently', () => {
      const msg: SdkMessageLike = {
        type: 'assistant',
        message: {
          id: 'msg_unknown',
          content: [
            { type: 'thinking', thinking: 'reasoning…' },
            { type: 'text', text: 'visible' },
          ],
        },
        uuid: 'u',
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([
        { type: 'text-delta', messageId: 'msg_unknown', text: 'visible' },
      ]);
    });
  });

  describe('user messages (tool results)', () => {
    it('emits a tool-result for a tool_result content block', () => {
      const msg: SdkMessageLike = {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: 'file contents here',
            },
          ],
        },
        parent_tool_use_id: 'msg_parent',
        uuid: 'u-result',
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([
        {
          type: 'tool-result',
          messageId: 'msg_parent',
          id: 'toolu_01',
          output: 'file contents here',
        },
      ]);
    });

    it('marks tool-result with isError when is_error is true', () => {
      const msg: SdkMessageLike = {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_03',
              content: 'permission denied',
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: 'msg_parent',
      };
      const events = mapSdkMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool-result',
        id: 'toolu_03',
        isError: true,
      });
    });

    it('skips user messages whose content is plain string (not tool result)', () => {
      const msg: SdkMessageLike = {
        type: 'user',
        message: { content: 'plain user text' },
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([]);
    });

    it('emits multiple tool-results when a user message carries several blocks', () => {
      const msg: SdkMessageLike = {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'a' },
            { type: 'tool_result', tool_use_id: 't2', content: 'b' },
            { type: 'text', text: 'noise' },
          ],
        },
        parent_tool_use_id: 'msg_p',
      };
      const events = mapSdkMessage(msg);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'tool-result', id: 't1' });
      expect(events[1]).toMatchObject({ type: 'tool-result', id: 't2' });
    });
  });

  describe('result messages', () => {
    it('emits message-complete with usage', () => {
      const msg: SdkMessageLike = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        uuid: 'msg_final',
        usage: { input_tokens: 120, output_tokens: 84 },
      };
      const events = mapSdkMessage(msg);
      expect(events).toEqual([
        {
          type: 'message-complete',
          messageId: 'msg_final',
          usage: { inputTokens: 120, outputTokens: 84 },
        },
      ]);
    });

    it('emits message-complete without usage when SDK omits it', () => {
      const msg: SdkMessageLike = {
        type: 'result',
        subtype: 'success',
        uuid: 'msg_no_usage',
      };
      const events = mapSdkMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'message-complete',
        messageId: 'msg_no_usage',
      });
      expect((events[0] as { usage?: unknown }).usage).toBeUndefined();
    });
  });

  describe('system / unknown messages', () => {
    it('swallows system init', () => {
      const msg: SdkMessageLike = {
        type: 'system',
        subtype: 'init',
      };
      expect(mapSdkMessage(msg)).toEqual([]);
    });

    it('swallows unknown message types without throwing', () => {
      const msg: SdkMessageLike = {
        type: 'stream_event',
        // shape we don't model
      } as SdkMessageLike;
      expect(mapSdkMessage(msg)).toEqual([]);
    });

    it('passes log calls to the optional logger for system messages', () => {
      const calls: Array<{ msg: string; meta?: unknown }> = [];
      const logger = {
        debug: (m: string, meta?: Record<string, unknown>) =>
          calls.push({ msg: m, meta }),
      };
      mapSdkMessage(
        { type: 'system', subtype: 'init' } as SdkMessageLike,
        logger,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].meta).toEqual({ subtype: 'init' });
    });
  });

  describe('end-to-end SDK message stream → AgentEvent[]', () => {
    it('translates a typical turn (init → assistant text → tool_use → tool_result → result) to the expected event sequence', () => {
      const stream: SdkMessageLike[] = [
        { type: 'system', subtype: 'init' },
        {
          type: 'assistant',
          message: {
            id: 'msg_a1',
            content: [{ type: 'text', text: "I'll read the file." }],
          },
          uuid: 'u1',
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_a2',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_x',
                name: 'Read',
                input: { file_path: '/x.ts' },
              },
            ],
          },
          uuid: 'u2',
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_x',
                content: 'export const x = 1;',
              },
            ],
          },
          parent_tool_use_id: 'msg_a2',
          uuid: 'u3',
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_a3',
            content: [{ type: 'text', text: 'Done.' }],
          },
          uuid: 'u4',
        },
        {
          type: 'result',
          subtype: 'success',
          uuid: 'msg_a3',
          usage: { input_tokens: 50, output_tokens: 12 },
        },
      ];

      const events = stream.flatMap((m) => mapSdkMessage(m));
      const types = events.map((e) => e.type);
      expect(types).toEqual([
        'text-delta',
        'tool-call',
        'tool-result',
        'text-delta',
        'message-complete',
      ]);
    });
  });
});

describe('file-edit helpers', () => {
  it('isFileEditTool recognises Write / Edit / MultiEdit', () => {
    expect(isFileEditTool('Write')).toBe(true);
    expect(isFileEditTool('Edit')).toBe(true);
    expect(isFileEditTool('MultiEdit')).toBe(true);
    expect(isFileEditTool('Read')).toBe(false);
    expect(isFileEditTool('Bash')).toBe(false);
  });

  it('extractFileEditPath pulls file_path from tool input', () => {
    expect(extractFileEditPath({ file_path: '/foo.ts' })).toBe('/foo.ts');
    expect(extractFileEditPath({ path: '/foo.ts' })).toBeUndefined();
    expect(extractFileEditPath(null)).toBeUndefined();
    expect(extractFileEditPath('foo')).toBeUndefined();
  });

  it('extractFileEditContents returns after for Write', () => {
    expect(
      extractFileEditContents('Write', {
        file_path: '/x',
        content: 'hello',
      }),
    ).toEqual({ after: 'hello' });
  });

  it('extractFileEditContents returns before+after for Edit', () => {
    expect(
      extractFileEditContents('Edit', {
        file_path: '/x',
        old_string: 'foo',
        new_string: 'bar',
      }),
    ).toEqual({ before: 'foo', after: 'bar' });
  });

  it('extractFileEditContents returns first edit for MultiEdit', () => {
    expect(
      extractFileEditContents('MultiEdit', {
        file_path: '/x',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toEqual({ before: 'a', after: 'b' });
  });

  it('extractFileEditContents returns empty for unknown shapes', () => {
    expect(extractFileEditContents('Edit', null)).toEqual({});
    expect(extractFileEditContents('Write', { file_path: '/x' })).toEqual({});
    expect(extractFileEditContents('Other', { foo: 'bar' })).toEqual({});
  });
});
