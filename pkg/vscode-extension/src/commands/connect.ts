/**
 * `flowlib.connect` / `flowlib.disconnect` commands.
 *
 * Connect flow:
 *   1. Prompt for backend URL (pre-filled with current setting).
 *   2. Validate via `isValidBackendUrl`.
 *   3. Prompt for API key (optional — backend may not require auth).
 *   4. Try `BackendClient.healthCheck()`. On success: store key in
 *      SecretStorage, write URL to settings, update status bar.
 *      On failure: show error notification, leave config untouched.
 *
 * Disconnect flow:
 *   1. Confirm.
 *   2. Clear API key from SecretStorage. Leave URL in settings (user might
 *      want to reconnect later).
 *   3. Update status bar to offline.
 */

import * as vscode from 'vscode';
import { isValidBackendUrl } from '../util/config';
import { BackendClient } from '../backend/BackendClient';
import type { Backend } from '../backend/Backend';
import { clearApiKey, readBackendCredentials, setBackendUrl, storeApiKey } from '../backend/config';
import type { BackendStatusBar } from '../backend/statusBar';
import { getExtensionLogger } from '../util/logger';

export interface ConnectDeps {
  context: vscode.ExtensionContext;
  statusBar: BackendStatusBar;
  /** Called when the active backend changes. `null` means "fall back to embedded". */
  onConnectionChange?: (client: Backend | null) => void;
}

export function registerConnectCommands(deps: ConnectDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('flowlib.connect', () => connect(deps)),
    vscode.commands.registerCommand('flowlib.disconnect', () => disconnect(deps)),
  ];
}

async function connect(deps: ConnectDeps): Promise<void> {
  const logger = getExtensionLogger();
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const current = await readBackendCredentials(deps.context, folder);

  const url = await vscode.window.showInputBox({
    prompt: 'Invect backend URL',
    placeHolder: 'http://localhost:3000/flowlib',
    value: current.url,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'URL is required';
      }
      const v = isValidBackendUrl(value.trim());
      return v.ok ? null : v.reason;
    },
    ignoreFocusOut: true,
  });
  if (!url) {
    return;
  } // user cancelled

  const apiKey = await vscode.window.showInputBox({
    prompt: 'API key (optional)',
    placeHolder: 'Leave empty if your backend does not require auth',
    password: true,
    value: current.apiKey ?? '',
    ignoreFocusOut: true,
  });
  // User cancelled the input box. Not a secret comparison — timing-attack
  // rule is a false positive on `=== undefined`.
  // eslint-disable-next-line security/detect-possible-timing-attacks
  if (apiKey === undefined) {
    return;
  }

  // Test the connection before persisting anything.
  const client = new BackendClient({ url: url.trim(), apiKey: apiKey || undefined });
  try {
    await client.healthCheck();
  } catch (err) {
    const msg = (err as Error).message;
    logger.error('backend connection failed', { url, error: msg });
    deps.statusBar.set({ kind: 'error', url, message: msg });
    void vscode.window.showErrorMessage(`Couldn't reach Invect backend: ${msg}`);
    return;
  }

  await setBackendUrl(url.trim(), folder);
  if (apiKey) {
    await storeApiKey(deps.context, apiKey, folder);
  } else {
    await clearApiKey(deps.context, folder);
  }
  deps.statusBar.set({ kind: 'connected', url: url.trim() });
  deps.onConnectionChange?.(client);
  logger.info('connected to backend', { url });
  void vscode.window.showInformationMessage(`Connected to ${url}`);
}

async function disconnect(deps: ConnectDeps): Promise<void> {
  const logger = getExtensionLogger();
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const choice = await vscode.window.showWarningMessage(
    'Disconnect from the remote Invect backend? Falls back to the embedded local backend.',
    { modal: true },
    'Disconnect',
  );
  if (choice !== 'Disconnect') {
    return;
  }
  await clearApiKey(deps.context, folder);
  deps.statusBar.set({ kind: 'embedded' });
  // null tells the lifecycle owner to swap back to the embedded backend.
  deps.onConnectionChange?.(null);
  logger.info('disconnected from backend (returned to embedded)');
}
