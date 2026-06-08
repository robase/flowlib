import { describe, expect, it, vi } from 'vitest';

import { createHookPipeline } from '../pipeline';
import { DEFAULT_POST_HANDLERS, DEFAULT_PRE_HANDLERS } from '../handlers';
import type { AuditWriter } from '../../audit/writer';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { PostToolUseContext, PreToolUseContext } from '../types';

const auth: AgentsAuthContext = { userId: 'u1', orgId: 'org-a', role: 'user', teamIds: [] };

function fakeAudit() {
  const writes: Array<{ eventType: string; toolName?: string; payload?: unknown }> = [];
  const writer: AuditWriter = {
    write: vi.fn(async (input) => {
      writes.push({ eventType: input.eventType, toolName: input.toolName, payload: input.payload });
      return null;
    }),
  };
  return { writer, writes };
}

const preCtx = (toolName: string, input: unknown): PreToolUseContext<unknown> => ({
  sessionId: 's',
  auth,
  toolName,
  toolCallId: 'tc',
  iteration: 1,
  input,
});
const postCtx = (toolName: string, output: unknown): PostToolUseContext<unknown, unknown> => ({
  sessionId: 's',
  auth,
  toolName,
  toolCallId: 'tc',
  iteration: 1,
  input: {},
  output,
  isError: false,
});

describe('createHookPipeline (with default security handlers)', () => {
  it('blocks a dangerous command and writes a tool_blocked audit event', async () => {
    const { writer, writes } = fakeAudit();
    const pipeline = createHookPipeline({
      pre: DEFAULT_PRE_HANDLERS,
      post: DEFAULT_POST_HANDLERS,
      audit: writer,
    });

    const decision = await pipeline.runPreToolUse(
      preCtx('sandbox.run_shell', { command: 'rm -rf /' }),
    );
    expect(decision.continue).toBe(false);
    expect(writes).toEqual([
      expect.objectContaining({ eventType: 'tool_blocked', toolName: 'sandbox.run_shell' }),
    ]);
  });

  it('allows a safe call through with continue: true and no audit', async () => {
    const { writer, writes } = fakeAudit();
    const pipeline = createHookPipeline({ pre: DEFAULT_PRE_HANDLERS, audit: writer });
    const decision = await pipeline.runPreToolUse(
      preCtx('sandbox.read_file', { path: 'src/a.ts' }),
    );
    expect(decision.continue).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('redacts secrets in PostToolUse output and audits secret_redacted', async () => {
    const { writer, writes } = fakeAudit();
    const pipeline = createHookPipeline({ post: DEFAULT_POST_HANDLERS, audit: writer });
    const decision = await pipeline.runPostToolUse(
      postCtx('sandbox.run_shell', 'token sk-ant-abcdefghij0123456789ABCDEF'),
    );
    expect(decision.continue).toBe(true);
    expect(String(decision.modifiedOutput)).toContain('[REDACTED]');
    expect(writes[0]?.eventType).toBe('secret_redacted');
  });

  it('propagates terminate from a post handler (private key) and audits secret_terminated', async () => {
    const { writer, writes } = fakeAudit();
    const pipeline = createHookPipeline({ post: DEFAULT_POST_HANDLERS, audit: writer });
    const decision = await pipeline.runPostToolUse(
      postCtx('sandbox.read_file', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'),
    );
    expect(decision.terminate).toBe(true);
    expect(writes[0]?.eventType).toBe('secret_terminated');
  });

  it('runs without an audit writer (security still enforced)', async () => {
    const pipeline = createHookPipeline({ pre: DEFAULT_PRE_HANDLERS });
    const decision = await pipeline.runPreToolUse(preCtx('write_file', { path: '.env' }));
    expect(decision.continue).toBe(false);
  });

  it('fails open per-handler: a throwing handler is skipped, later handlers still run', async () => {
    const pipeline = createHookPipeline({
      pre: [
        () => {
          throw new Error('buggy handler');
        },
        (ctx) =>
          ctx.toolName === 'x' ? { continue: false, reason: 'second handler blocked' } : undefined,
      ],
      logger: { warn: vi.fn() },
    });
    const decision = await pipeline.runPreToolUse(preCtx('x', {}));
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe('second handler blocked');
  });

  it('threads modifiedInput through to the returned decision', async () => {
    const pipeline = createHookPipeline({
      pre: [() => ({ continue: true, modifiedInput: { redacted: true } })],
    });
    const decision = await pipeline.runPreToolUse(preCtx('any', { redacted: false }));
    expect(decision.continue).toBe(true);
    expect(decision.modifiedInput).toEqual({ redacted: true });
  });
});
