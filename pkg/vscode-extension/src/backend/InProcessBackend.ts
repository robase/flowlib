/**
 * `InProcessBackend` — thin wrapper around an in-process `@flowlib/express`
 * server, with the workspace's `.flow.ts` files as the source of truth
 * for the flow definitions themselves.
 *
 * Architecture:
 *   - On first use, `getEmbeddedServer(ctx)` boots an Express server on
 *     `127.0.0.1:<random>` serving `@flowlib/express`'s router.
 *   - HTTP-only operations (runs, credentials, node executions, etc.)
 *     delegate to a `BackendClient` pointed at that URL.
 *   - File-as-source-of-truth ops (`listFlows`, `getFlow`,
 *     `createFlow`, `updateFlow`) read/write workspace files directly.
 *   - `runFlow(fileUri)` parses the file, ensures a stable DB row exists
 *     (tagged with `__file__:<uri>`), pushes a fresh version with the
 *     current contents, then starts the run via HTTP.
 */

import * as vscode from 'vscode';
import { emitSdkSource, mergeParsedIntoDefinition } from '@flowlib/sdk';
import type { DbFlowDefinition } from '@flowlib/sdk';

import { getExtensionLogger } from '../util/logger';
import { parseFlowFile } from '../flow-file/parse';
import type { SseHandler } from './sse';
import {
  type Backend,
  type BackendDescriptor,
  type FlowSummary,
  type NodeExecutionSummary,
  type PushFlowResult,
  type RunStartResult,
  type RunSummary,
} from './Backend';
import { BackendClient } from './BackendClient';
import { disposeEmbeddedServer, getEmbeddedServer } from './inprocess-server';
import { FileSync } from './file-sync';

/**
 * Callback fired whenever a file → DB version push succeeds. Lets
 * the host (extension.ts) push a "definition changed" message into
 * any open webview so the canvas re-fetches the new graph without
 * waiting for a manual refresh.
 */
export type DefinitionChangedListener = (fileUri: string, dbFlowId: string) => void;

const FILE_TAG_PREFIX = '__file__:';

export class InProcessBackend implements Backend {
  private clientPromise: Promise<BackendClient> | undefined;
  private serverUrl: string | undefined;
  private dbPath: string | undefined;
  private bus: import('@flowlib/core').ExecutionEventBus | undefined;
  /** fileUri → dbFlowId. Hydrated lazily on first lookup. */
  private readonly fileToDbFlow = new Map<string, string>();
  /** Reverse: dbFlowId → fileUri. Kept in sync with fileToDbFlow. */
  private readonly dbFlowToFile = new Map<string, string>();
  /**
   * dbFlowId → hash of the last `flowlibDefinition` we pushed for that
   * flow. Idempotency guard: if a caller (file watcher, sendInit retry,
   * subscribeFlowRuns) tries to push the same content twice, skip it.
   * Catches feedback loops at the source instead of the round-trip.
   */
  private readonly lastPushedDefHash = new Map<string, string>();
  private mapHydrated = false;
  /**
   * Bidirectional file ↔ DB sync. Created up-front so its middleware can
   * be passed into the embedded server on first boot, and so the
   * extension's file watcher can call `syncFileToDb` immediately.
   */
  readonly fileSync: FileSync;
  /** Listeners notified after each successful file → DB version push. */
  private readonly definitionListeners = new Set<DefinitionChangedListener>();

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.fileSync = new FileSync({
      getFileUriForFlow: (flowId) => this.dbFlowToFile.get(flowId),
      ensureFlowForFile: (uri) => this.ensureFlowForFile(uri),
      pushVersion: async (flowId, definition) => {
        await this.pushSdkParsedAsVersion(flowId, definition);
      },
      onAfterDbPush: (fileUri, dbFlowId) => {
        for (const cb of this.definitionListeners) {
          try {
            cb(fileUri, dbFlowId);
          } catch (err) {
            getExtensionLogger().warn('definitionChanged listener threw', {
              error: (err as Error).message,
            });
          }
        }
      },
    });
  }

  /**
   * Subscribe to "flow definition changed" events. Fires after every
   * successful file → DB version push (file watcher + text-document
   * handler). Returns an unsubscriber.
   */
  onDefinitionChanged(cb: DefinitionChangedListener): () => void {
    this.definitionListeners.add(cb);
    return () => {
      this.definitionListeners.delete(cb);
    };
  }

  /** URL of the in-process server. Resolves once the server has booted. */
  async getServerUrl(): Promise<string> {
    await this.client();
    if (!this.serverUrl) {
      // `client()` sets `serverUrl` synchronously after the embedded
      // server boots. Reaching here means the boot succeeded but the
      // assignment didn't — a programming error worth surfacing.
      throw new Error('embedded server URL unavailable after boot');
    }
    return this.serverUrl;
  }

  /**
   * Look up the DB flow id backing `fileUri` without creating one.
   * Returns `undefined` if the file has never been opened (no
   * `__file__:<uri>` tag exists). Cheap — only a map lookup after the
   * first hydrate.
   *
   * Used by the custom editor to deep-link the webview when the
   * current file content has parse errors but a previous good version
   * exists in the DB.
   */
  async findFlowIdForFile(fileUri: string): Promise<string | undefined> {
    await this.client();
    await this.hydrateMap();
    return this.fileToDbFlow.get(fileUri);
  }

  /**
   * Resolve `fileUri` to the DB flow row backing it, creating the row +
   * pushing the file's current contents as a new version. Used by the
   * custom editor to deep-link the webview to the right flow.
   */
  async ensureFlowForFile(fileUri: vscode.Uri): Promise<string> {
    const flow = (await this.getFlow(fileUri.toString())) as Record<string, unknown>;
    const dbFlowId = await this.ensureDbFlow(fileUri.toString(), flow);
    // Always push a fresh version so the canvas opens with the latest
    // file content. Cheap (DB insert) and keeps drift between file and
    // DB to a single open + render cycle.
    try {
      await this.pushSdkParsedAsVersion(dbFlowId, flow);
    } catch (err) {
      getExtensionLogger().warn('ensureFlowForFile: pushing version failed', {
        fileUri: fileUri.toString(),
        error: (err as Error).message,
      });
    }
    return dbFlowId;
  }

  /**
   * Convert an SDK-parsed flow (`{ nodes, edges, metadata }` with
   * `referenceId` only — no `id` fields) into the DB-shape the API
   * expects, then POST as a new version.
   *
   * The merge against the prior version preserves node ids across
   * re-saves so per-node DB rows (run history, executions) stay
   * attached to the same conceptual node. For a brand-new flow with
   * no prior version, fresh ids are generated.
   */
  private async pushSdkParsedAsVersion(dbFlowId: string, parsed: unknown): Promise<void> {
    // Idempotency guard: skip if the parsed definition is structurally
    // identical to what we last pushed for this flow. Multiple callers
    // (file watcher, `sendInit` retry, `subscribeFlowRuns` lazy-fetch,
    // `runFlow`) may all hit this with the same content within a few
    // hundred ms; without this guard they'd each create a new
    // flow_version row, fanning out into a runaway loop.
    const parsedHash = this.fileSync.hash(parsed);
    if (this.lastPushedDefHash.get(dbFlowId) === parsedHash) {
      return;
    }

    const c = await this.client();
    let prior: DbFlowDefinition | null = null;
    try {
      const latest = await c.get<{ flowlibDefinition?: DbFlowDefinition }>(
        `/flows/${encodeURIComponent(dbFlowId)}/versions/latest`,
      );
      prior = latest?.flowlibDefinition ?? null;
    } catch (err) {
      // 404 on first save is normal — no prior version exists yet.
      const msg = (err as Error).message ?? '';
      if (!/\b404\b/.test(msg)) {
        getExtensionLogger().debug('pushVersion: prior fetch failed', { dbFlowId, error: msg });
      }
    }

    // If the prior DB version already represents the same flow as what
    // we're about to push, skip the no-op write. (Catches the case where
    // we don't have `lastPushedDefHash` yet — e.g. fresh extension boot
    // against a pre-existing DB row.)
    if (prior && this.fileSync.hash(prior) === parsedHash) {
      this.lastPushedDefHash.set(dbFlowId, parsedHash);
      return;
    }

    const p = parsed as { nodes?: unknown[]; edges?: unknown[]; metadata?: unknown };
    const merged = mergeParsedIntoDefinition(
      {
        nodes: (p.nodes ?? []) as Parameters<typeof mergeParsedIntoDefinition>[0]['nodes'],
        edges: (p.edges ?? []) as Parameters<typeof mergeParsedIntoDefinition>[0]['edges'],
        metadata: p.metadata as Parameters<typeof mergeParsedIntoDefinition>[0]['metadata'],
      },
      prior,
    );
    await c.post(`/flows/${encodeURIComponent(dbFlowId)}/versions`, {
      flowlibDefinition: merged,
    });
    this.lastPushedDefHash.set(dbFlowId, parsedHash);
  }

  describe(): BackendDescriptor {
    return {
      label: 'embedded',
      kind: 'embedded',
      detail: this.dbPath,
    };
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    const c = await this.client();
    return c.healthCheck();
  }

  async listActions(): Promise<unknown[]> {
    const c = await this.client();
    return c.listActions();
  }

  /**
   * Source of truth = workspace `.flow.ts` files. Each file becomes one
   * tree item; the file URI is its id.
   */
  async listFlows(): Promise<FlowSummary[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*.flow.ts',
      '**/{node_modules,.git,dist,out,build}/**',
    );
    const trusted = vscode.workspace.isTrusted;
    const summaries: FlowSummary[] = [];
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const src = new TextDecoder().decode(bytes);
        const result = await parseFlowFile(src, { trusted });
        if (result.ok) {
          const meta =
            (result.flow as { metadata?: { name?: string; description?: string } }).metadata ?? {};
          summaries.push({
            id: uri.toString(),
            name: meta.name ?? basename(uri.path),
            description: meta.description,
            fileUri: uri.toString(),
          });
        } else {
          summaries.push({
            id: uri.toString(),
            name: basename(uri.path),
            description: `Parse error: ${result.error}`,
            fileUri: uri.toString(),
          });
        }
      } catch (err) {
        getExtensionLogger().warn('listFlows: read failed', {
          uri: uri.toString(),
          error: (err as Error).message,
        });
      }
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getFlow(id: string): Promise<unknown> {
    const uri = vscode.Uri.parse(id);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const src = new TextDecoder().decode(bytes);
    const result = await parseFlowFile(src, { trusted: vscode.workspace.isTrusted });
    if (!result.ok) {
      throw new Error(`Failed to parse ${uri.fsPath}: ${result.error}`);
    }
    return result.flow;
  }

  async createFlow(definition: unknown): Promise<PushFlowResult> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('Open a workspace folder first — embedded mode writes flows to disk.');
    }
    const def = definition as Record<string, unknown>;
    const meta = (def.metadata as { name?: string } | undefined) ?? {};
    const name = (def.name as string) ?? meta.name ?? 'untitled';
    const slug = slugify(name);
    const target = vscode.Uri.joinPath(folder.uri, 'flows', `${slug}.flow.ts`);

    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, 'flows'));
    const code = emitSdkSource(definition as Parameters<typeof emitSdkSource>[0]).code;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(code));

    return { id: target.toString(), fileUri: target.toString() };
  }

  async updateFlow(id: string, definition: unknown): Promise<PushFlowResult> {
    const uri = vscode.Uri.parse(id);
    const code = emitSdkSource(definition as Parameters<typeof emitSdkSource>[0]).code;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(code));
    return { id, fileUri: id };
  }

  /**
   * Read + parse the file → resolve (or create) the persistent DB flow
   * row → push a fresh version with current contents → start the run.
   */
  async runFlow(id: string, inputs: Record<string, unknown>): Promise<RunStartResult> {
    const flow = (await this.getFlow(id)) as Record<string, unknown>;
    const dbFlowId = await this.ensureDbFlow(id, flow);
    // Push a fresh version (merged into prior to preserve node ids) so
    // the run executes the *current* file content.
    await this.pushSdkParsedAsVersion(dbFlowId, flow);
    const c = await this.client();
    const r = await c.runFlow(dbFlowId, inputs);
    return { ...r, flowId: dbFlowId };
  }

  async runEphemeral(
    definition: unknown,
    inputs: Record<string, unknown>,
  ): Promise<RunStartResult> {
    const c = await this.client();
    return c.runEphemeral(definition, inputs);
  }

  async listRuns(flowId: string): Promise<RunSummary[]> {
    const dbFlowId = await this.resolveDbFlow(flowId);
    if (!dbFlowId) {
      return [];
    }
    const c = await this.client();
    return c.listRuns(dbFlowId);
  }

  async listNodeExecutions(runId: string): Promise<NodeExecutionSummary[]> {
    const c = await this.client();
    return c.listNodeExecutions(runId);
  }

  async streamRunEvents(runId: string, onEvent: SseHandler, signal?: AbortSignal): Promise<void> {
    const c = await this.client();
    return c.streamRunEvents(runId, onEvent, signal);
  }

  async shutdown(): Promise<void> {
    await disposeEmbeddedServer();
    this.clientPromise = undefined;
    this.serverUrl = undefined;
    this.fileToDbFlow.clear();
    this.dbFlowToFile.clear();
    this.lastPushedDefHash.clear();
    this.mapHydrated = false;
  }

  // ── File ↔ DB flow mapping ─────────────────────────────────────────────

  private async resolveDbFlow(fileUri: string): Promise<string | undefined> {
    await this.hydrateMap();
    return this.fileToDbFlow.get(fileUri);
  }

  /**
   * Create the DB flow row on first run for a given file. Tags it with
   * `__file__:<uri>` so subsequent extension sessions can rebuild the
   * mapping by listing flows.
   */
  private async ensureDbFlow(fileUri: string, flow: Record<string, unknown>): Promise<string> {
    const existing = await this.resolveDbFlow(fileUri);
    if (existing) {
      return existing;
    }
    const c = await this.client();
    const meta = (flow.metadata as { name?: string; description?: string } | undefined) ?? {};
    const created = await c.post<{ id: string }>('/flows', {
      name: meta.name ?? basename(vscode.Uri.parse(fileUri).path),
      description: meta.description,
      tags: [`${FILE_TAG_PREFIX}${fileUri}`],
    });
    this.fileToDbFlow.set(fileUri, created.id);
    this.dbFlowToFile.set(created.id, fileUri);
    return created.id;
  }

  private async hydrateMap(): Promise<void> {
    if (this.mapHydrated) {
      return;
    }
    const c = await this.client();
    try {
      // Express router exposes the list under /flows/list, not /flows.
      const raw = await c.get<unknown>('/flows/list?limit=100');
      const items = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] }).data ?? []);
      for (const f of items as Record<string, unknown>[]) {
        const tags = (f.tags as string[] | undefined) ?? [];
        const fileTag = tags.find((t) => t.startsWith(FILE_TAG_PREFIX));
        if (fileTag && typeof f.id === 'string') {
          const fileUri = fileTag.slice(FILE_TAG_PREFIX.length);
          this.fileToDbFlow.set(fileUri, f.id);
          this.dbFlowToFile.set(f.id, fileUri);
        }
      }
    } catch (err) {
      getExtensionLogger().warn('hydrateMap failed', { error: (err as Error).message });
    }
    this.mapHydrated = true;
  }

  private async client(): Promise<BackendClient> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const handle = await getEmbeddedServer(this.ctx, {
          preRouterMiddleware: this.fileSync.middleware(),
        });
        this.serverUrl = handle.url;
        this.dbPath = handle.dbPath;
        this.bus = handle.bus;
        return new BackendClient({ url: handle.url });
      })();
    }
    return this.clientPromise;
  }

  /**
   * Subscribe to flow-level run events for the file at `fileUri`. Fires
   * whenever a flow_run.updated lands for this flow's DB row.
   *
   * If the file's DB row doesn't exist yet (file never opened), this
   * creates it via `ensureFlowForFile` so the subscription can attach
   * to a real channel. Without this, racing with the editor's own
   * row-creation would silently produce a no-op subscription, and the
   * sidebar would miss every event.
   */
  async subscribeFlowRuns(fileUri: string, callback: () => void): Promise<() => void> {
    await this.client(); // ensures bus is set
    let dbFlowId = this.fileToDbFlow.get(fileUri);
    if (!dbFlowId) {
      try {
        dbFlowId = await this.ensureFlowForFile(vscode.Uri.parse(fileUri));
      } catch (err) {
        getExtensionLogger().warn('subscribeFlowRuns: ensureFlowForFile failed', {
          fileUri,
          error: (err as Error).message,
        });
        return () => undefined;
      }
    }
    if (!this.bus) {
      return () => undefined;
    }
    return this.bus.subscribeFlow(dbFlowId, () => callback());
  }
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  const file = idx >= 0 ? path.slice(idx + 1) : path;
  return file.replace(/\.flow\.ts$/, '');
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
