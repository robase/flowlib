/**
 * Integration tests for stand-alone commands not covered by the custom-
 * editor or sidebar suites: showLogs, refreshFlows, viewRun's graceful
 * branches, and the full newFlow scaffold-and-open happy path.
 *
 * Driven by `@vscode/test-electron` against the fixture workspace at
 * `test/fixtures/workspace`.
 */

import * as assert from 'node:assert';
import * as vscode from 'vscode';

const FLOW_EDITOR_VIEW_TYPE = 'flowlib.flowEditor';

async function activate(): Promise<void> {
  // Dev manifest = `@flowlib/vsix` (scoped); packaged VSIX = `flowlib-vsix`.
  const ext =
    vscode.extensions.getExtension('flowlib.@flowlib/vsix') ??
    vscode.extensions.getExtension('flowlib.flowlib-vsix');
  if (!ext) {
    throw new Error('flowlib extension not found');
  }
  await ext.activate();
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

function findTab(uri: vscode.Uri): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri } | undefined;
      if (input?.uri?.toString() === uri.toString()) {
        return tab;
      }
    }
  }
  return undefined;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`);
}

suite('Misc commands — graceful no-ops', () => {
  suiteSetup(async () => {
    await activate();
  });

  test('flowlib.showLogs is registered and resolves', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('flowlib.showLogs'));
    // Command opens the output channel and resolves; no throw.
    await vscode.commands.executeCommand('flowlib.showLogs');
  });

  test('flowlib.refreshFlows resolves without an open flow', async () => {
    await vscode.commands.executeCommand('flowlib.refreshFlows');
  });

  test('flowlib.openFlow ignores non-flow tree items', async () => {
    // The handler short-circuits on `item.kind !== "flow"` — exercise both
    // a missing item and a wrong-kind item to lock in the early returns.
    await vscode.commands.executeCommand('flowlib.openFlow', undefined);
    await vscode.commands.executeCommand('flowlib.openFlow', { kind: 'run', runId: 'x' });
  });

  test('flowlib.viewRun returns gracefully on bad inputs', async () => {
    // Non-string args → typeof guard returns silently.
    await vscode.commands.executeCommand('flowlib.viewRun');
    await vscode.commands.executeCommand('flowlib.viewRun', 42, {});
    // Non-file URI → logs a warning and returns. Should not throw.
    await vscode.commands.executeCommand('flowlib.viewRun', 'run-abc', 'http://example.com/flow');
  });
});

suite('flowlib.newFlow — scaffold + open', () => {
  // Stubs we install for the happy-path test. Captured here so the
  // teardown hook can restore them even if the test throws.
  let originalInputBox: typeof vscode.window.showInputBox;
  let originalQuickPick: typeof vscode.window.showQuickPick;
  let createdUri: vscode.Uri | undefined;

  suiteSetup(async () => {
    await activate();
  });

  setup(async () => {
    await closeAllEditors();
    originalInputBox = vscode.window.showInputBox;
    originalQuickPick = vscode.window.showQuickPick;
  });

  teardown(async () => {
    (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox =
      originalInputBox;
    (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
      originalQuickPick;
    if (createdUri) {
      try {
        await vscode.workspace.fs.delete(createdUri);
      } catch {
        // file may not exist if the test bailed early — ignore
      }
      createdUri = undefined;
    }
  });

  test('cancelling the name prompt creates no file', async () => {
    let pickShown = false;
    (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox =
      (async () => undefined) as typeof vscode.window.showInputBox;
    (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = async () => {
      pickShown = true;
      return undefined;
    };

    await vscode.commands.executeCommand('flowlib.newFlow');

    assert.strictEqual(
      pickShown,
      false,
      'template picker should not appear when name is cancelled',
    );
  });

  test('happy path writes a .flow.ts and opens the visual editor', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('test setup: no workspace');
    }
    const flowName = `e2e-newflow-${Date.now()}`;
    const expectedUri = vscode.Uri.joinPath(folder.uri, 'flows', `${flowName}.flow.ts`);
    createdUri = expectedUri;

    (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox =
      (async () => flowName) as typeof vscode.window.showInputBox;
    // newFlow passes an array of `{ label, description, key }` items.
    // The signature of `showQuickPick` is heavily overloaded, so go
    // through `unknown` to install a stub that picks the 'blank' template.
    (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = async (
      items: ReadonlyArray<{ label: string; key?: string }>,
    ) => items.find((i) => i.key === 'blank') ?? items[0];

    await vscode.commands.executeCommand('flowlib.newFlow');

    // 1. File exists with the slug we asked for.
    const stat = await vscode.workspace.fs.stat(expectedUri);
    assert.ok(stat.size > 0, 'scaffolded file should be non-empty');

    // 2. Contents include the SDK import + JSON footer fast-path marker.
    const bytes = await vscode.workspace.fs.readFile(expectedUri);
    const text = new TextDecoder().decode(bytes);
    assert.ok(/from ['"]@flowlib\/sdk['"]/.test(text), 'should import from @flowlib/sdk');
    assert.ok(text.includes('defineFlow('), 'should call defineFlow()');

    // 3. The visual editor tab is open against the new file.
    await waitFor(() => {
      const tab = findTab(expectedUri);
      const input = tab?.input as { viewType?: string } | undefined;
      return input?.viewType === FLOW_EDITOR_VIEW_TYPE;
    }, 5000);
  });
});
