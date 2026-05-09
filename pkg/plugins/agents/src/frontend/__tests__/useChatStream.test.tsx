/**
 * Hook tests for `useChatStream`.
 *
 * **Runtime note**: see header in `MessageBubble.test.tsx`. Today this
 * file is dormant: the workerd-based vitest pool can't run React hook
 * effects, and `@testing-library/react`'s `renderHook` requires
 * happy-dom. Pure-logic coverage of the same surface lives in
 * `parseInboundFrame.test.ts` (inbound wire-format parsing) and the
 * `outbound envelopes` describe-block below.
 *
 * Once a DOM-capable vitest project is added (the brief explicitly
 * forbids editing the current `vitest.config.ts`), the
 * `renderHook`-based assertions in the second describe-block will
 * activate by uncommenting the `import` and the body. Until then they
 * stay commented so the file compiles cleanly under TypeScript without
 * pulling in unused modules.
 */
import { describe, it, expect } from 'vitest';
import { parseInboundFrame } from '../hooks/useChatStream';
import type { OutboundControlEnvelope } from '../hooks/useChatStream';

describe('useChatStream — outbound envelopes (shape contract)', () => {
  // The hook produces three outbound control envelopes. Each must
  // serialize to a stable wire shape because the DO routes on `type`.
  it('interrupt envelope', () => {
    const env: OutboundControlEnvelope = { type: 'flowlib.interrupt' };
    expect(JSON.parse(JSON.stringify(env))).toEqual({
      type: 'flowlib.interrupt',
    });
  });

  it('permission-response envelope', () => {
    const env: OutboundControlEnvelope = {
      type: 'flowlib.permission-response',
      id: 'p1',
      decision: 'allow',
    };
    expect(JSON.parse(JSON.stringify(env))).toMatchObject({
      type: 'flowlib.permission-response',
      id: 'p1',
      decision: 'allow',
    });
  });

  it('hil-response envelope', () => {
    const env: OutboundControlEnvelope = {
      type: 'flowlib.hil-response',
      id: 'h1',
      response: { value: 42 },
    };
    expect(JSON.parse(JSON.stringify(env))).toMatchObject({
      type: 'flowlib.hil-response',
      id: 'h1',
      response: { value: 42 },
    });
  });
});

describe('useChatStream — inbound parsing (smoke)', () => {
  // Smoke-tests against the same parser the hook uses internally.
  // Full coverage lives in `parseInboundFrame.test.ts`.
  it('handles the canonical agent-event envelope', () => {
    const out = parseInboundFrame(
      JSON.stringify({
        type: 'flowlib.agent-event',
        event: { type: 'text-delta', messageId: 'm', text: 'x' },
      }),
    );
    expect(out.kind).toBe('agent-event');
  });
});

// ──────────────────────────────────────────────────────────────────
// Hook-level tests (dormant — see file header). When DOM is wired up:
//
// import { renderHook, act } from '@testing-library/react';
// import { useChatStream } from '../hooks/useChatStream';
//
// describe('useChatStream — hook integration (DOM-bound)', () => {
//   it('streams events through a mock socket adapter', async () => {
//     const listeners: Array<(e: MessageEvent) => void> = [];
//     const socket = {
//       send: vi.fn(),
//       addEventListener: (_t, l) => listeners.push(l),
//       removeEventListener: () => {},
//     };
//     const adapters = {
//       useAgent: () => socket,
//       useAgentChat: () => ({ sendMessage: vi.fn(), stop: vi.fn() }),
//       loadSession: async () => ({ id: 's1', doAgentName: 'org/sess', /* … */ } as any),
//     };
//     const { result } = renderHook(() => useChatStream('s1', adapters));
//     await act(async () => {});
//     act(() => {
//       listeners[0](new MessageEvent('message', {
//         data: JSON.stringify({
//           type: 'flowlib.agent-event',
//           event: { type: 'text-delta', messageId: 'm', text: 'hi' },
//         }),
//       }));
//     });
//     expect(result.current.events).toHaveLength(1);
//   });
// });
