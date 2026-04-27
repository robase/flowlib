/**
 * `flowlib.pullFromBackend` / `flowlib.pushToBackend` — file ↔ backend sync.
 *
 * Pull flow:
 *   1. List backend flows; if no `flowId` arg passed, QuickPick.
 *   2. `getFlow(id)` → emit canonical `.flow.ts` source via `@flowlib/sdk`'s
 *      `emitSdkSource({ includeJsonFooter: true, metadata: { id } })`.
 *   3. Write to `<workspace>/flows/<slug>.flow.ts`.
 *   4. Open the file (uses our `FlowEditorProvider` automatically).
 *
 * Push flow:
 *   1. Read the active editor's `.flow.ts`.
 *   2. Parse footer / evaluator → `SdkFlowDefinition`.
 *   3. If footer has `metadata.id`, `updateFlow(id, ...)`. Else `createFlow(...)`.
 *   4. Write the returned `id` back into the file's footer for next time.
 */

import * as vscode from 'vscode';
import { emitSdkSource } from '@flowlib/sdk';
import type { Backend } from '../backend/Backend';
import { parseFlowFile } from '../flow-file/parse';
import { getExtensionLogger } from '../util/logger';

export interface SyncDeps {
  /** Returns the active backend client, or null if disconnected. */
  getClient: () => Backend | null;
  /** Called after a push assigns a new flow id, so the explorer can refresh. */
  onFlowsChanged?: () => void;
}

export function registerSyncCommands(deps: SyncDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('flowlib.pullFromBackend', (flowId?: string) =>
      pull(deps, flowId),
    ),
    vscode.commands.registerCommand('flowlib.pushToBackend', () => push(deps)),
  ];
}

async function pull(deps: SyncDeps, presetFlowId?: string): Promise<void> {
  const logger = getExtensionLogger();
  const client = deps.getClient();
  if (!client) {
    void vscode.window.showWarningMessage('Connect to an Invect backend first.');
    return;
  }

  let flowId = presetFlowId;
  if (!flowId) {
    const flows = await client.listFlows();
    if (flows.length === 0) {
      void vscode.window.showInformationMessage('No flows on this backend.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      flows.map((f) => ({ label: f.name ?? f.id, description: f.id, flowId: f.id })),
      { placeHolder: 'Pick a flow to pull' },
    );
    if (!pick) {
      return;
    }
    flowId = pick.flowId;
  }

  let flow: unknown;
  try {
    flow = await client.getFlow(flowId);
  } catch (err) {
    void vscode.window.showErrorMessage(`Pull failed: ${(err as Error).message}`);
    return;
  }

  // Embed the backend id in the metadata so push knows which row to update.
  const flowName = (flow as { name?: string }).name ?? flowId;
  const slug = slugify(flowName);
  const code = emitSdkSource(flow as unknown as Parameters<typeof emitSdkSource>[0], {
    metadata: { id: flowId } as Record<string, unknown>,
  }).code;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Open a folder first — pull writes a .flow.ts file.');
    return;
  }
  const target = vscode.Uri.joinPath(folder.uri, 'flows', `${slug}.flow.ts`);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, 'flows'));
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(code));

  logger.info('pulled flow', { flowId, target: target.toString() });
  await vscode.commands.executeCommand('vscode.openWith', target, 'flowlib.flowEditor');
  deps.onFlowsChanged?.();
}

async function push(deps: SyncDeps): Promise<void> {
  const logger = getExtensionLogger();
  const client = deps.getClient();
  if (!client) {
    void vscode.window.showWarningMessage('Connect to an Invect backend first.');
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith('.flow.ts')) {
    void vscode.window.showWarningMessage('Open a .flow.ts file to push.');
    return;
  }
  const result = await parseFlowFile(editor.document.getText(), {
    trusted: vscode.workspace.isTrusted,
  });
  if (!result.ok) {
    void vscode.window.showErrorMessage(`Push failed: ${result.error}`);
    return;
  }

  const flow = result.flow as unknown as Record<string, unknown>;
  const meta = (flow.metadata ?? {}) as Record<string, unknown>;
  const existingId = typeof meta.id === 'string' ? meta.id : undefined;

  let pushed: { id: string };
  try {
    pushed = existingId ? await client.updateFlow(existingId, flow) : await client.createFlow(flow);
  } catch (err) {
    void vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
    return;
  }

  // Embed the assigned id (if new) into the file so the next push updates.
  if (!existingId) {
    const newCode = emitSdkSource(flow as unknown as Parameters<typeof emitSdkSource>[0], {
      metadata: { ...meta, id: pushed.id },
    }).code;
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length),
    );
    edit.replace(editor.document.uri, fullRange, newCode);
    await vscode.workspace.applyEdit(edit);
  }

  logger.info('pushed flow', { flowId: pushed.id, isNew: !existingId });
  void vscode.window.showInformationMessage(
    existingId ? `Pushed updates to ${pushed.id}` : `Created new flow ${pushed.id}`,
  );
  deps.onFlowsChanged?.();
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
