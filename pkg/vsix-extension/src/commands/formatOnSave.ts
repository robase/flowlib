/**
 * Format-on-save for `.flow.ts` — re-emits the file via `@flowlib/sdk`'s
 * canonical emitter when `flowlib.formatOnSave` is true.
 *
 * Subscribes to `workspace.onWillSaveTextDocument` and uses
 * `event.waitUntil(Promise<TextEdit[]>)` to insert the canonical formatting
 * before the file hits disk. Off by default — most users have Prettier /
 * oxfmt at the repo level and we don't want to fight it.
 *
 * No-ops when:
 *   - the setting is off
 *   - the file isn't `*.flow.ts`
 *   - parse fails (we don't want to mangle a broken file on save)
 */

import * as vscode from 'vscode';
import { emitSdkSource } from '@flowlib/sdk';
import { parseFlowFile } from '../flow-file/parse';
import { readConfig } from '../util/config';
import { getExtensionLogger } from '../util/logger';

export function registerFormatOnSave(): vscode.Disposable {
  return vscode.workspace.onWillSaveTextDocument((event) => {
    if (!event.document.fileName.endsWith('.flow.ts')) {
      return;
    }
    const config = readConfig(event.document.uri);
    if (!config.formatOnSave) {
      return;
    }
    event.waitUntil(formatDocument(event.document));
  });
}

async function formatDocument(doc: vscode.TextDocument): Promise<vscode.TextEdit[]> {
  const logger = getExtensionLogger();
  const oldSrc = doc.getText();
  const result = await parseFlowFile(oldSrc, { trusted: vscode.workspace.isTrusted });
  if (!result.ok) {
    logger.debug('format-on-save: parse failed; leaving file untouched', { error: result.error });
    return [];
  }
  let newSrc: string;
  try {
    newSrc = emitSdkSource(result.flow as unknown as Parameters<typeof emitSdkSource>[0]).code;
  } catch (err) {
    logger.warn('format-on-save: emit failed; leaving file untouched', {
      error: (err as Error).message,
    });
    return [];
  }
  if (newSrc === oldSrc) {
    return [];
  }
  const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(oldSrc.length));
  return [vscode.TextEdit.replace(fullRange, newSrc)];
}
