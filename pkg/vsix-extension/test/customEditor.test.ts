/**
 * Integration tests for the `.flow.ts` custom editor + the visual ↔
 * code toggle commands.
 *
 * Runs inside a real VSCode (via @vscode/test-electron) with the
 * fixture workspace at `test/fixtures/workspace`. Each test exercises
 * the same surfaces a user would touch: opening the file, swapping
 * editors via the title-bar commands, etc.
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

const FLOW_EDITOR_VIEW_TYPE = 'flowlib.flowEditor';

function fixtureFlow(): vscode.Uri {
  // The launchArgs in runTest.ts open the workspace at this path, so
  // workspace-relative resolution would also work — using
  // workspaceFolders is more robust to CWD changes.
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('test setup: no workspace folder');
  }
  return vscode.Uri.joinPath(folder.uri, 'flows', 'sample.flow.ts');
}

async function activateExtension(): Promise<void> {
  // Dev manifest is `@flowlib/vsix` → `flowlib.@flowlib/vsix`; the
  // packaged VSIX uses `flowlib-vsix` → `flowlib.flowlib-vsix`.
  const candidateIds = ['flowlib.@flowlib/vsix', 'flowlib.flowlib-vsix'];
  for (const id of candidateIds) {
    const ext = vscode.extensions.getExtension(id);
    if (ext) {
      await ext.activate();
      return;
    }
  }
  throw new Error(`extension not found by ${candidateIds.join(' or ')}`);
}

/**
 * Find the first tab whose input URI matches `uri`. We can't rely on
 * `activeTextEditor` because the custom editor is the active *tab* but
 * not a text editor.
 */
function findTab(uri: vscode.Uri): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
      if (input?.uri?.toString() === uri.toString()) {
        return tab;
      }
    }
  }
  return undefined;
}

/** Find every tab whose input URI matches `uri`, across all tab groups. */
function findAllTabs(uri: vscode.Uri): vscode.Tab[] {
  const out: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
      if (input?.uri?.toString() === uri.toString()) {
        out.push(tab);
      }
    }
  }
  return out;
}

/** Dump for diagnostic assertion messages. */
function describeTabs(uri: vscode.Uri): string {
  const tabs = findAllTabs(uri);
  return tabs
    .map((t, i) => {
      const input = t.input as { viewType?: string } | undefined;
      const viewType = input?.viewType ?? '(no viewType — text editor)';
      return `[${i}] active=${t.isActive} viewType=${viewType}`;
    })
    .join('; ');
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

suite('Custom editor + visual ↔ code toggle', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  setup(async () => {
    await closeAllEditors();
  });

  test('opening a .flow.ts uses the FlowEditor custom editor by default', async () => {
    const uri = fixtureFlow();
    await vscode.commands.executeCommand('vscode.openWith', uri, FLOW_EDITOR_VIEW_TYPE);

    const tab = findTab(uri);
    assert.ok(tab, 'expected a tab for the opened flow');
    const input = tab!.input as { viewType?: string };
    assert.strictEqual(
      input.viewType,
      FLOW_EDITOR_VIEW_TYPE,
      'tab input should be the custom editor',
    );
  });

  test('flowlib.editAsCode swaps the open custom editor for a text editor', async () => {
    const uri = fixtureFlow();
    await vscode.commands.executeCommand('vscode.openWith', uri, FLOW_EDITOR_VIEW_TYPE);
    assert.ok(findTab(uri), 'precondition: custom editor open');

    await vscode.commands.executeCommand('flowlib.editAsCode');

    // Wait for a *text-editor tab* (no `viewType` on the input) to exist
    // for this URI. Polling on `activeTextEditor` alone isn't enough —
    // VSCode may keep the original custom-editor tab alive in another
    // group, and `findTab` would still return that one.
    await waitFor(
      () =>
        findAllTabs(uri).some((t) => {
          const input = t.input as { viewType?: string } | undefined;
          return input?.viewType !== FLOW_EDITOR_VIEW_TYPE;
        }),
      2000,
    );

    // The active text editor should now be focused on this URI.
    const ed = vscode.window.activeTextEditor;
    assert.ok(
      ed,
      `expected an active text editor after editAsCode. tabs: ${describeTabs(uri)}`,
    );
    assert.strictEqual(ed!.document.uri.toString(), uri.toString());
  });

  test('flowlib.editVisually swaps the open text editor for the custom editor', async () => {
    const uri = fixtureFlow();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    await waitFor(() => !!vscode.window.activeTextEditor, 2000);

    await vscode.commands.executeCommand('flowlib.editVisually');

    // Some tab somewhere should now be the custom editor for this URI.
    // Don't assume `findTab` returns the right one — there may be a
    // residual text-editor tab in another group.
    try {
      await waitFor(
        () =>
          findAllTabs(uri).some((t) => {
            const input = t.input as { viewType?: string } | undefined;
            return input?.viewType === FLOW_EDITOR_VIEW_TYPE;
          }),
        2000,
      );
    } catch (err) {
      throw new Error(
        `editVisually did not produce a custom-editor tab. tabs: ${describeTabs(uri)}`,
      );
    }
  });

  test('toggle commands no-op gracefully with no .flow.ts active', async () => {
    // No file open. Both commands should resolve without throwing —
    // they show a warning notification instead.
    await vscode.commands.executeCommand('flowlib.editAsCode');
    await vscode.commands.executeCommand('flowlib.editVisually');
  });
});

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
