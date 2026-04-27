/**
 * Agent-tool lifecycle integration tests.
 *
 * Agent nodes carry attached tools under `params.addedTools[]`. Each tool
 * instance has a stable `instanceId` that flow-run metadata and the chat
 * assistant's history may reference. The Phase 3 merge helper promised to
 * preserve these `instanceId`s across source-level edits — these tests
 * verify that promise end-to-end against a real Flowlib instance via the
 * Phase 7 chat SDK tools.
 *
 * Scenarios covered:
 *   - Creating an agent with tools via `write_flow_source` mints fresh ids.
 *   - Editing non-tool params leaves tool instanceIds intact.
 *   - Renaming a tool's display name (same toolId) keeps its instanceId.
 *   - Adding a new tool keeps existing instanceIds and mints one fresh.
 *   - Removing a tool leaves remaining instanceIds untouched.
 *   - Reordering tools preserves identity by `toolId+name+description` match.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import fsSync from 'node:fs';
import { join } from 'node:path';
import type { FlowlibInstance } from '../../../src/api/types';
import type { ChatToolContext, ChatToolResult } from '../../../src/services/chat/chat-types';
import {
  getFlowSourceTool,
  editFlowSourceTool,
  writeFlowSourceTool,
} from '../../../src/services/chat/tools/sdk-tools';
import { createTestFlowlib } from '../helpers/test-flowlib';

function ensureSdkBuilt(): void {
  const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
  const sdkDist = join(repoRoot, 'pkg', 'sdk', 'dist', 'index.mjs');
  if (!fsSync.existsSync(sdkDist)) {
    execSync('pnpm --filter @flowlib/sdk build', { cwd: repoRoot, stdio: 'inherit' });
  }
}

interface ToolInstance {
  instanceId: string;
  toolId: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
}

function getAgentTools(flowlib: FlowlibInstance, flowId: string): Promise<ToolInstance[]> {
  return flowlib.versions.get(flowId, 'latest').then((v) => {
    if (!v?.flowlibDefinition) {
      return [];
    }
    const agent = v.flowlibDefinition.nodes.find((n) => n.type === 'core.agent');
    return (agent?.params?.addedTools ?? []) as ToolInstance[];
  });
}

describe('Chat SDK tools — agent-tool lifecycle', () => {
  let flowlib: FlowlibInstance;
  let baseCtx: Omit<ChatToolContext, 'chatContext'>;

  beforeAll(async () => {
    ensureSdkBuilt();
    flowlib = await createTestFlowlib();
    baseCtx = { flowlib };
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

  let flowId: string;
  beforeEach(async () => {
    const flow = await flowlib.flows.create({ name: 'Agent tool lifecycle test' });
    flowId = flow.id;
  });

  describe('create agent with tools', () => {
    it('mints fresh instanceIds for each tool at creation', async () => {
      const source = `
import { defineFlow, input, agent, tool } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('prompt'),
    agent('assistant', {
      credentialId: 'cred',
      model: 'gpt-4o',
      taskPrompt: 'Do the thing',
      addedTools: [
        tool('gmail.send_message', { description: 'Send email' }),
        tool('slack.send_message', { description: 'Post to slack' }),
      ],
    }),
  ],
  edges: [{ from: 'prompt', to: 'assistant' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const tools = await getAgentTools(flowlib, flowId);
      expect(tools).toHaveLength(2);
      expect(tools[0].toolId).toBe('gmail.send_message');
      expect(tools[0].instanceId).toMatch(/^tool_/);
      expect(tools[1].toolId).toBe('slack.send_message');
      expect(tools[1].instanceId).toMatch(/^tool_/);
      expect(tools[0].instanceId).not.toBe(tools[1].instanceId);
    });
  });

  describe('preservation across edits', () => {
    async function seedAgentWithTools() {
      const source = `
import { defineFlow, input, agent, tool } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('prompt'),
    agent('assistant', {
      credentialId: 'cred',
      model: 'gpt-4o',
      taskPrompt: 'Original task',
      addedTools: [
        tool('gmail.send_message', { description: 'Send email' }),
        tool('slack.send_message', { description: 'Post to slack' }),
      ],
    }),
  ],
  edges: [{ from: 'prompt', to: 'assistant' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);
      return await getAgentTools(flowlib, flowId);
    }

    it('editing a non-tool param leaves tool instanceIds intact', async () => {
      const before = await seedAgentWithTools();

      // Get the source and edit the agent's taskPrompt.
      const { data } = await getFlowSourceTool.execute({}, { ...baseCtx, chatContext: { flowId } });
      const source = (data as { source: string }).source;

      const editResult: ChatToolResult = await editFlowSourceTool.execute(
        {
          oldString: `taskPrompt: "Original task",`,
          newString: `taskPrompt: "Updated task",`,
        },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(editResult.success).toBe(true);

      const after = await getAgentTools(flowlib, flowId);
      expect(after).toHaveLength(2);
      expect(after[0].instanceId).toBe(before[0].instanceId);
      expect(after[1].instanceId).toBe(before[1].instanceId);
      // Reference the source so lint doesn't complain about unused binding.
      expect(source).toContain('Original task');
    });

    it('renaming a tool description keeps its instanceId (secondary toolId match)', async () => {
      const before = await seedAgentWithTools();

      const editResult = await editFlowSourceTool.execute(
        {
          oldString: `description: "Send email"`,
          newString: `description: "Send email to the requester"`,
        },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(editResult.success).toBe(true);

      const after = await getAgentTools(flowlib, flowId);
      const gmailBefore = before.find((t) => t.toolId === 'gmail.send_message')!;
      const gmailAfter = after.find((t) => t.toolId === 'gmail.send_message')!;
      expect(gmailAfter.instanceId).toBe(gmailBefore.instanceId);
      expect(gmailAfter.description).toBe('Send email to the requester');
    });

    it('adding a third tool mints a new instanceId without disturbing the others', async () => {
      const before = await seedAgentWithTools();

      const newSource = `
import { defineFlow, input, agent, tool } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('prompt'),
    agent('assistant', {
      credentialId: 'cred',
      model: 'gpt-4o',
      taskPrompt: 'Original task',
      addedTools: [
        tool('gmail.send_message', { description: 'Send email' }),
        tool('slack.send_message', { description: 'Post to slack' }),
        tool('github.create_issue', { description: 'Open a github issue' }),
      ],
    }),
  ],
  edges: [{ from: 'prompt', to: 'assistant' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source: newSource },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const after = await getAgentTools(flowlib, flowId);
      expect(after).toHaveLength(3);
      expect(after.find((t) => t.toolId === 'gmail.send_message')?.instanceId).toBe(
        before[0].instanceId,
      );
      expect(after.find((t) => t.toolId === 'slack.send_message')?.instanceId).toBe(
        before[1].instanceId,
      );
      expect(after.find((t) => t.toolId === 'github.create_issue')?.instanceId).toMatch(/^tool_/);
      // New tool's instanceId must differ from existing ones.
      const githubId = after.find((t) => t.toolId === 'github.create_issue')!.instanceId;
      expect(githubId).not.toBe(before[0].instanceId);
      expect(githubId).not.toBe(before[1].instanceId);
    });

    it('removing a tool leaves remaining instanceIds untouched', async () => {
      const before = await seedAgentWithTools();

      // Rewrite without the slack tool.
      const newSource = `
import { defineFlow, input, agent, tool } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('prompt'),
    agent('assistant', {
      credentialId: 'cred',
      model: 'gpt-4o',
      taskPrompt: 'Original task',
      addedTools: [
        tool('gmail.send_message', { description: 'Send email' }),
      ],
    }),
  ],
  edges: [{ from: 'prompt', to: 'assistant' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source: newSource },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const after = await getAgentTools(flowlib, flowId);
      expect(after).toHaveLength(1);
      expect(after[0].toolId).toBe('gmail.send_message');
      expect(after[0].instanceId).toBe(before[0].instanceId);
    });

    it('reordering tools preserves identity by toolId+name+description match', async () => {
      const before = await seedAgentWithTools();

      // Swap the order — slack first, then gmail.
      const newSource = `
import { defineFlow, input, agent, tool } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('prompt'),
    agent('assistant', {
      credentialId: 'cred',
      model: 'gpt-4o',
      taskPrompt: 'Original task',
      addedTools: [
        tool('slack.send_message', { description: 'Post to slack' }),
        tool('gmail.send_message', { description: 'Send email' }),
      ],
    }),
  ],
  edges: [{ from: 'prompt', to: 'assistant' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source: newSource },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const after = await getAgentTools(flowlib, flowId);
      expect(after).toHaveLength(2);
      // Order now slack, gmail — each still has its original instanceId.
      expect(after[0].toolId).toBe('slack.send_message');
      expect(after[0].instanceId).toBe(
        before.find((t) => t.toolId === 'slack.send_message')!.instanceId,
      );
      expect(after[1].toolId).toBe('gmail.send_message');
      expect(after[1].instanceId).toBe(
        before.find((t) => t.toolId === 'gmail.send_message')!.instanceId,
      );
    });

    it('duplicate toolIds with different descriptions get separate instanceIds', async () => {
      const source = `
import { defineFlow, input, agent, tool } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('prompt'),
    agent('assistant', {
      credentialId: 'cred',
      model: 'gpt-4o',
      taskPrompt: 'Task',
      addedTools: [
        tool('gmail.send_message', { name: 'Send Alert', description: 'Alert path' }),
        tool('gmail.send_message', { name: 'Send Report', description: 'Report path' }),
      ],
    }),
  ],
  edges: [{ from: 'prompt', to: 'assistant' }],
});
`;
      await writeFlowSourceTool.execute({ source }, { ...baseCtx, chatContext: { flowId } });

      const tools = await getAgentTools(flowlib, flowId);
      expect(tools).toHaveLength(2);
      expect(tools[0].instanceId).not.toBe(tools[1].instanceId);

      // Round-trip: the emitter renders them back, the transform re-applies
      // the merge. Each tool keeps its instanceId by toolId+name+description.
      const idAlert = tools.find((t) => t.name === 'Send Alert')!.instanceId;
      const idReport = tools.find((t) => t.name === 'Send Report')!.instanceId;

      // Trigger a re-save of the same flow.
      const secondResult = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(secondResult.success).toBe(true);

      const toolsAfter = await getAgentTools(flowlib, flowId);
      expect(toolsAfter.find((t) => t.name === 'Send Alert')?.instanceId).toBe(idAlert);
      expect(toolsAfter.find((t) => t.name === 'Send Report')?.instanceId).toBe(idReport);
    });
  });
});
