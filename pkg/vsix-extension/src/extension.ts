import * as vscode from 'vscode';
import { getExtensionLogger } from './util/logger';
import { FlowEditorProvider } from './editor/FlowEditorProvider';
import { FlowlibPanelProvider } from './editor/FlowlibPanel';
import { BackendStatusBar } from './backend/statusBar';
import type { Backend } from './backend/Backend';
import { InProcessBackend } from './backend/InProcessBackend';
import { registerConnectCommands } from './commands/connect';
import { registerSyncCommands } from './commands/syncFlow';
import { registerNewFlowCommand } from './commands/newFlow';
import { registerFormatOnSave } from './commands/formatOnSave';
import { registerShowMcpConfigCommand } from './commands/showMcpConfig';
import { registerLanguageModelTools } from './lm-tools';
import { BackendsExplorerProvider } from './views/BackendsExplorer';
import { FlowsExplorerProvider } from './views/FlowsExplorer';
import { SimpleSectionViewProvider } from './views/SimpleSectionView';

/**
 * Activation entry. Layout:
 *
 *   - Embedded backend boots a real `@flowlib/express` server in-process.
 *   - Custom editor for `.flow.ts` opens the full Flowlib UI in a webview
 *     deep-linked to the flow row backing the file.
 *   - VSCode side panel hosts navigation:
 *       Backends → swap backends
 *       Flows    → expand to per-flow runs; click run to open + jump
 *       Credentials → open the embedded UI's /credentials page
 *       Webhooks    → open the embedded UI's /webhooks page (plugin)
 *   - Flowlib's own internal sidebar is hidden via CSS in theme-bridge.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  const logger = getExtensionLogger();
  logger.info('Flowlib extension activated', { trusted: vscode.workspace.isTrusted });

  // Switch the SDK's `defineFlow` into lenient mode for the lifetime of
  // this extension host. Mid-edit flows often have dangling edges,
  // duplicate refs, etc.; we'd rather render the partial graph than
  // refuse to open the canvas. Production servers leave this unset.
  process.env.FLOWLIB_SDK_LENIENT = '1';

  // ── Backend (default = embedded) ───────────────────────────────────────────
  const statusBar = new BackendStatusBar();
  const embeddedBackend = new InProcessBackend(ctx);
  let currentBackend: Backend = embeddedBackend;
  const getBackend = (): Backend => currentBackend;

  statusBar.set({ kind: 'embedded' });

  // ── Side-panel views ───────────────────────────────────────────────────────
  const backendsExplorer = new BackendsExplorerProvider();
  backendsExplorer.setActiveKind('embedded');
  const flowsExplorer = new FlowsExplorerProvider();
  flowsExplorer.setClient(embeddedBackend);
  const credentialsView = new SimpleSectionViewProvider([
    {
      label: 'Open credentials manager…',
      description: 'in editor',
      iconId: 'key',
      command: 'flowlib.openCredentials',
    },
  ]);
  const webhooksView = new SimpleSectionViewProvider([
    {
      label: 'Open webhooks…',
      description: 'in editor',
      iconId: 'plug',
      command: 'flowlib.openWebhooks',
    },
  ]);

  // ── Flowlib panel — opens non-file routes (credentials, webhooks, etc.)
  const flowlibPanel = new FlowlibPanelProvider(ctx, () => embeddedBackend.getServerUrl());

  // ── Custom editor — needs the embedded server URL + a file→DB-flow
  // resolver. Only the embedded backend exposes those today.
  const editorProvider = new FlowEditorProvider(ctx, {
    getBackend,
    getApiUrl: () => embeddedBackend.getServerUrl(),
    ensureFlowForFile: (uri) => embeddedBackend.ensureFlowForFile(uri),
    findFlowIdForFile: (uri) => embeddedBackend.findFlowIdForFile(uri),
    subscribeFlowRuns: (fileUri, cb) => embeddedBackend.subscribeFlowRuns(fileUri, cb),
  });

  ctx.subscriptions.push(
    statusBar,
    flowlibPanel,
    { dispose: () => void embeddedBackend.shutdown().catch(() => undefined) },

    // ── Commands ──────────────────────────────────────────────────────────
    vscode.commands.registerCommand('flowlib.hello', () => {
      vscode.window.showInformationMessage('Hello from Flowlib');
    }),
    vscode.commands.registerCommand('flowlib.showLogs', () => {
      logger.show(true);
    }),
    vscode.commands.registerCommand('flowlib.trustWorkspace', () => {
      void vscode.commands.executeCommand('workbench.trust.manage');
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      logger.info('workspace trust granted');
    }),

    // Open a recorded run inside the file's editor, jumped to the runs
    // view with `runId` preselected AND the canvas pinned to the flow
    // version that ran (so a historical run renders against the
    // definition that was actually executed, not the current latest).
    vscode.commands.registerCommand(
      'flowlib.viewRun',
      async (runId: string, flowIdOrFileUri: string, flowVersion?: number) => {
        if (typeof runId !== 'string' || typeof flowIdOrFileUri !== 'string') {
          return;
        }
        if (!flowIdOrFileUri.startsWith('file:')) {
          logger.warn('viewRun: non-file flow ids not supported in embedded mode');
          return;
        }
        const fileUri = vscode.Uri.parse(flowIdOrFileUri);
        let dbFlowId: string;
        try {
          dbFlowId = await embeddedBackend.ensureFlowForFile(fileUri);
        } catch (err) {
          logger.error('viewRun: ensureFlowForFile failed', { error: (err as Error).message });
          return;
        }
        await vscode.commands.executeCommand(
          'vscode.openWith',
          fileUri,
          FlowEditorProvider.viewType,
        );
        // Pin to the run's version when known. The `runs/version/:n`
        // route maps to the same FlowRunsView component but passes
        // `flowVersion` through to `useFlowReactFlowData`.
        const versionSegment =
          typeof flowVersion === 'number'
            ? `/version/${encodeURIComponent(String(flowVersion))}`
            : '';
        const path = `/flowlib/flow/${encodeURIComponent(dbFlowId)}/runs${versionSegment}?runId=${encodeURIComponent(runId)}`;
        // Wait briefly for the panel to register before posting.
        for (let i = 0; i < 20; i++) {
          if (FlowEditorProvider.postTo(fileUri, { type: 'navigate', path })) {
            return;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        logger.warn('viewRun: webview never registered, navigate dropped', {
          fileUri: flowIdOrFileUri,
        });
      },
    ),

    vscode.commands.registerCommand('flowlib.openCredentials', () =>
      flowlibPanel.open('credentials', 'Flowlib: Credentials', '/flowlib/credentials'),
    ),
    vscode.commands.registerCommand('flowlib.openWebhooks', () =>
      flowlibPanel.open('webhooks', 'Flowlib: Webhooks', '/flowlib/webhooks'),
    ),

    // ── Visual ↔ Code toggle ─────────────────────────────────────────────
    // Open the active .flow.ts in VSCode's default text editor. Useful
    // when the visual canvas is currently active and the user wants to
    // edit the source directly. Wired to an editor-title button and the
    // command palette via package.json `menus`.
    vscode.commands.registerCommand('flowlib.editAsCode', async () => {
      const uri = activeFlowFileUri();
      if (!uri) {
        void vscode.window.showWarningMessage('Open a .flow.ts file first.');
        return;
      }
      // `'default'` = VSCode's built-in text editor. Even when our custom
      // editor is registered with `priority: default`, this view-type
      // bypasses it.
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }),
    vscode.commands.registerCommand('flowlib.editVisually', async () => {
      const uri = activeFlowFileUri();
      if (!uri) {
        void vscode.window.showWarningMessage('Open a .flow.ts file first.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, FlowEditorProvider.viewType);
    }),

    // ── Custom editor + sidebar registrations ─────────────────────────────
    vscode.window.registerCustomEditorProvider(FlowEditorProvider.viewType, editorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.window.registerTreeDataProvider('flowlib.backends', backendsExplorer),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('flowlib.backendUrl')) {
        backendsExplorer.refresh();
      }
    }),

    // Use `createTreeView` (not `registerTreeDataProvider`) so we can
    // call `treeView.reveal()` from the openFlow command. The provider
    // manages its own per-flow subscriptions across both embedded and
    // HTTP backends — the tree view itself only needs the reveal handle.
    flowsExplorer,
    (() => {
      const treeView = vscode.window.createTreeView('flowlib.flows', {
        treeDataProvider: flowsExplorer,
        showCollapseAll: true,
      });

      // `flowlib.openFlow` — single-click on a flow row both opens the
      // file and expands the row to reveal its runs. VSCode's default
      // tree behaviour fires the row command on click but doesn't
      // expand; we use treeView.reveal({ expand: true }) to do both.
      const openFlowCmd = vscode.commands.registerCommand(
        'flowlib.openFlow',
        async (item: import('./views/FlowsExplorer').FlowsExplorerItem) => {
          if (!item || item.kind !== 'flow') {
            return;
          }
          if (item.fileUri) {
            await vscode.commands.executeCommand(
              'vscode.openWith',
              vscode.Uri.parse(item.fileUri),
              FlowEditorProvider.viewType,
            );
          }
          await treeView.reveal(item, { expand: true, focus: false, select: true });
        },
      );

      return {
        dispose: () => {
          openFlowCmd.dispose();
          treeView.dispose();
        },
      };
    })(),
    vscode.window.registerTreeDataProvider('flowlib.credentials', credentialsView),
    vscode.window.registerTreeDataProvider('flowlib.webhooks', webhooksView),
    vscode.commands.registerCommand('flowlib.refreshFlows', () => flowsExplorer.refresh()),

    // Workspace file watcher:
    //   - Refresh the flows view when .flow.ts files come and go.
    //   - On change/create, push the new file content to the embedded
    //     backend as a new flow_version. The Flowlib SSE stream
    //     propagates to any open canvases. FileSync's loop-prevention
    //     hashes suppress echoes from canvas-driven writes.
    (() => {
      const watcher = vscode.workspace.createFileSystemWatcher('**/*.flow.ts');
      const sync = (uri: vscode.Uri): void => {
        flowsExplorer.refresh();
        if (currentBackend === embeddedBackend) {
          void embeddedBackend.fileSync.syncFileToDb(uri);
        }
      };
      watcher.onDidCreate(sync);
      watcher.onDidChange(sync);
      watcher.onDidDelete(() => flowsExplorer.refresh());
      return watcher;
    })(),

    // After a successful file → DB push, tell any open webview for that
    // file URI to invalidate its react-flow query cache so the canvas
    // re-fetches the new graph. The in-process ExecutionEventBus
    // doesn't emit on flow_version creation, so we bridge by hand.
    {
      dispose: embeddedBackend.onDefinitionChanged((fileUri, dbFlowId) => {
        try {
          FlowEditorProvider.postTo(vscode.Uri.parse(fileUri), {
            type: 'flowDefinitionChanged',
            flowId: dbFlowId,
          });
        } catch {
          /* fileUri parse failures are not actionable */
        }
      }),
    },

    // Save-driven text-editor → canvas sync. We deliberately do NOT
    // listen to `onDidChangeTextDocument` (every keystroke) — live sync
    // creates feedback loops with the canvas's auto-save and flickers
    // the UI mid-edit. Instead push only on explicit `onDidSaveTextDocument`,
    // which mirrors the user's mental model: edit-as-code, hit save, and
    // the canvas updates. The file-system watcher above also covers
    // external writes (git pull, prettier-on-save in another editor).
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (currentBackend !== embeddedBackend) {
        return;
      }
      if (!doc.fileName.endsWith('.flow.ts')) {
        return;
      }
      void embeddedBackend.fileSync.syncTextToDb(doc.uri, doc.getText());
    }),

    ...registerConnectCommands({
      context: ctx,
      statusBar,
      onConnectionChange: (next) => {
        currentBackend = next ?? embeddedBackend;
        flowsExplorer.setClient(currentBackend);
        const desc = currentBackend.describe();
        backendsExplorer.setActiveKind(
          desc.kind === 'embedded' ? 'embedded' : desc.kind === 'http' ? 'http' : 'disconnected',
        );
        logger.info('active backend changed', { kind: desc.kind, label: desc.label });
      },
    }),

    ...registerSyncCommands({
      getClient: getBackend,
      onFlowsChanged: () => flowsExplorer.refresh(),
    }),

    registerNewFlowCommand(),
    registerFormatOnSave(),

    // ── AI assistant integration ─────────────────────────────────────────
    // Surface MCP config to the user so they can wire Claude Code /
    // Cursor / Claude Desktop into the embedded server with one paste.
    registerShowMcpConfigCommand({
      getApiUrl: () => embeddedBackend.getServerUrl(),
    }),
    // Register Language Model Tools so VSCode-hosted LLMs (Copilot's
    // agent mode, Cursor's chat) can call our tools directly.
    ...registerLanguageModelTools({ getBackend }),
  );
}

export function deactivate(): void {
  // ctx.subscriptions handles cleanup, including the embedded server disposer.
}

/**
 * Resolve the URI of the active `.flow.ts` regardless of which editor
 * is showing it. The text editor surfaces via `activeTextEditor`; the
 * custom editor lives only in the active tab's input.
 */
function activeFlowFileUri(): vscode.Uri | undefined {
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.fileName.endsWith('.flow.ts')) {
    return ed.document.uri;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input as { uri?: vscode.Uri } | undefined;
  if (input?.uri && input.uri.fsPath.endsWith('.flow.ts')) {
    return input.uri;
  }
  return undefined;
}
