import * as assert from 'node:assert';
import * as vscode from 'vscode';

/**
 * Boots the extension host inside a real VSCode instance, runs the
 * `flowlib.hello` command, and asserts that the notification API was
 * called with the expected message.
 *
 * Driven by `@vscode/test-cli` (see `.vscode-test.mjs`).
 */
suite('Flowlib extension — smoke', () => {
  test('activate + flowlib.hello', async () => {
    // Activate the extension. The ID is `<publisher>.<package.name>` — the
    // dev manifest uses the scoped name `@flowlib/vsix`, so the dev ID is
    // `flowlib.@flowlib/vsix`. The packaged VSIX uses the unscoped
    // `flowlib-vsix` (rewritten by scripts/package.mjs), giving
    // `flowlib.flowlib-vsix`. Probe both so this test passes whether you
    // launch from source or from an installed VSIX.
    const candidateIds = ['flowlib.@flowlib/vsix', 'flowlib.flowlib-vsix'];
    let ext: vscode.Extension<unknown> | undefined;
    for (const id of candidateIds) {
      ext = vscode.extensions.getExtension(id);
      if (ext) {
        break;
      }
    }
    if (!ext) {
      const found = vscode.extensions.all
        .filter((e) => !e.id.startsWith('vscode.'))
        .map((e) => e.id);
      throw new Error(
        `extension not found by id ${candidateIds.join(' or ')}. Loaded non-builtin extensions: ${JSON.stringify(found)}`,
      );
    }
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('flowlib.hello'), 'flowlib.hello command not registered');

    // Stub showInformationMessage so the test asserts behavior without
    // requiring a real notification dismiss.
    const seen: string[] = [];
    const original = vscode.window.showInformationMessage;
    (
      vscode.window as unknown as {
        showInformationMessage: typeof vscode.window.showInformationMessage;
      }
    ).showInformationMessage = (async (message: string) => {
      seen.push(message);
      return undefined;
    }) as typeof vscode.window.showInformationMessage;

    try {
      await vscode.commands.executeCommand('flowlib.hello');
    } finally {
      (
        vscode.window as unknown as {
          showInformationMessage: typeof vscode.window.showInformationMessage;
        }
      ).showInformationMessage = original;
    }

    assert.deepStrictEqual(seen, ['Hello from Flowlib']);
  });
});
