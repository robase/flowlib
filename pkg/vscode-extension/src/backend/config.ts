/**
 * Backend connection config — backend URL from settings, API key from
 * `ExtensionContext.secrets`. Per-folder scoping so multi-root workspaces
 * can point at different backends.
 *
 * Layered on L9's `readConfig` / `isValidBackendUrl` — adds the SecretStorage
 * accessor so the secret never lands in `settings.json`.
 */

import * as vscode from 'vscode';
import { readConfig } from '../util/config';

const SECRET_PREFIX = 'flowlib.apiKey:';

function secretKey(scope: vscode.Uri | undefined): string {
  // Per-folder scope mirrors `flowlib.backendUrl` resource scope. Falls back
  // to a single global key when no folder is in play (single-file workspaces,
  // tests).
  return SECRET_PREFIX + (scope?.toString() ?? '__global__');
}

export interface BackendCredentials {
  url: string;
  apiKey: string | undefined;
}

export async function readBackendCredentials(
  ctx: vscode.ExtensionContext,
  scope?: vscode.Uri,
): Promise<BackendCredentials> {
  const config = readConfig(scope);
  const apiKey = await ctx.secrets.get(secretKey(scope));
  return { url: config.backendUrl, apiKey };
}

export async function storeApiKey(
  ctx: vscode.ExtensionContext,
  apiKey: string,
  scope?: vscode.Uri,
): Promise<void> {
  await ctx.secrets.store(secretKey(scope), apiKey);
}

export async function clearApiKey(ctx: vscode.ExtensionContext, scope?: vscode.Uri): Promise<void> {
  await ctx.secrets.delete(secretKey(scope));
}

export async function setBackendUrl(url: string, scope?: vscode.Uri): Promise<void> {
  // `ConfigurationTarget.WorkspaceFolder` matches the `"scope": "resource"`
  // declaration in the manifest. Falls back to Workspace when no folder.
  const target = scope
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Workspace;
  await vscode.workspace.getConfiguration('flowlib', scope).update('backendUrl', url, target);
}
