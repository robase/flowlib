/**
 * `flowlib.newFlow` — drop a starter `.flow.ts` into the workspace.
 *
 * Builds a `DbFlowDefinition` for each template and runs it through
 * `@flowlib/sdk`'s `emitSdkSource({ includeJsonFooter: true })`. Two reasons
 * to construct the DB shape directly instead of writing the TS by hand:
 *
 *   1. The emitter generates the canonical SDK source AND the
 *      `@flowlib-definition` JSON footer in one pass — every freshly
 *      scaffolded file parses through the regex fast path on first open
 *      (the evaluator can't resolve `@flowlib/sdk` from a temp eval dir,
 *      so footerless TS files would fail to load until they were saved
 *      through the editor at least once).
 *
 *   2. Keeps templates tied to the live SDK shape — if the emitter
 *      changes its formatting, scaffolds change with it instead of
 *      drifting.
 */

import * as vscode from 'vscode';
import { emitSdkSource } from '@flowlib/sdk';
import type { DbFlowDefinition } from '@flowlib/sdk';

interface Template {
  label: string;
  description: string;
  build: (name: string) => DbFlowDefinition;
}

function nodeId(): string {
  return `node_${Math.random().toString(36).slice(2, 10)}`;
}
function edgeId(): string {
  return `edge_${Math.random().toString(36).slice(2, 10)}`;
}

const TEMPLATES: Record<string, Template> = {
  blank: {
    label: 'Blank — input → output',
    description: 'Two-node skeleton you can build on',
    build: (name) => {
      const inId = nodeId();
      const outId = nodeId();
      return {
        nodes: [
          {
            id: inId,
            type: 'core.input',
            referenceId: 'payload',
            params: {},
            position: { x: 0, y: 0 },
          },
          {
            id: outId,
            type: 'core.output',
            referenceId: 'result',
            params: { value: 'ctx.payload' },
            position: { x: 280, y: 0 },
          },
        ],
        edges: [{ id: edgeId(), source: inId, target: outId }],
        metadata: { name },
      };
    },
  },
  agent: {
    label: 'Agent — single tool, simple loop',
    description: 'LLM agent with one Gmail tool attached (fill in credentialId)',
    build: (name) => {
      const inId = nodeId();
      const agentId = nodeId();
      const outId = nodeId();
      return {
        nodes: [
          {
            id: inId,
            type: 'core.input',
            referenceId: 'task',
            params: {},
            position: { x: 0, y: 0 },
          },
          {
            id: agentId,
            type: 'core.agent',
            referenceId: 'assistant',
            params: {
              credentialId: 'TODO_FILL_IN',
              model: 'claude-sonnet-4-0',
              taskPrompt: 'ctx.task',
              enabledTools: ['gmail.send_message'],
              maxIterations: 5,
              stopCondition: 'tool_result',
            },
            position: { x: 280, y: 0 },
          },
          {
            id: outId,
            type: 'core.output',
            referenceId: 'summary',
            params: { value: 'ctx.assistant' },
            position: { x: 560, y: 0 },
          },
        ],
        edges: [
          { id: edgeId(), source: inId, target: agentId },
          { id: edgeId(), source: agentId, target: outId },
        ],
        metadata: { name },
      };
    },
  },
  branch: {
    label: 'Branch — input → if/else → outputs',
    description: 'Conditional routing example',
    build: (name) => {
      const inId = nodeId();
      const ifId = nodeId();
      const alertId = nodeId();
      const logId = nodeId();
      return {
        nodes: [
          {
            id: inId,
            type: 'core.input',
            referenceId: 'event',
            params: {},
            position: { x: 0, y: 0 },
          },
          {
            id: ifId,
            type: 'core.if_else',
            referenceId: 'check',
            params: { condition: "ctx.event.priority === 'high'" },
            position: { x: 280, y: 0 },
          },
          {
            id: alertId,
            type: 'core.output',
            referenceId: 'alert',
            params: { value: "'High priority: ' + ctx.event.id" },
            position: { x: 560, y: -100 },
          },
          {
            id: logId,
            type: 'core.output',
            referenceId: 'log',
            params: { value: "'Logged: ' + ctx.event.id" },
            position: { x: 560, y: 100 },
          },
        ],
        edges: [
          { id: edgeId(), source: inId, target: ifId },
          { id: edgeId(), source: ifId, target: alertId, sourceHandle: 'true_output' },
          { id: edgeId(), source: ifId, target: logId, sourceHandle: 'false_output' },
        ],
        metadata: { name },
      };
    },
  },
};

export function registerNewFlowCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('flowlib.newFlow', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage('Open a folder first — newFlow writes a .flow.ts file.');
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'Flow name',
      placeHolder: 'My Flow',
      validateInput: (v) => (v.trim().length > 0 ? null : 'Name is required'),
    });
    if (!name) {
      return;
    }

    const pick = await vscode.window.showQuickPick(
      Object.entries(TEMPLATES).map(([key, t]) => ({
        label: t.label,
        description: t.description,
        key,
      })),
      { placeHolder: 'Pick a template' },
    );
    if (!pick) {
      return;
    }

    const template = TEMPLATES[pick.key];
    const def = template.build(name);
    let source: string;
    try {
      source = emitSdkSource(def).code;
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to emit template '${pick.key}': ${(err as Error).message}`,
      );
      return;
    }

    const slug = slugify(name);
    const target = vscode.Uri.joinPath(folder.uri, 'flows', `${slug}.flow.ts`);
    try {
      await vscode.workspace.fs.stat(target);
      void vscode.window.showErrorMessage(`File already exists: ${target.fsPath}`);
      return;
    } catch {
      // doesn't exist — good
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, 'flows'));
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(source));
    await vscode.commands.executeCommand('vscode.openWith', target, 'flowlib.flowEditor');
  });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'flow'
  );
}
