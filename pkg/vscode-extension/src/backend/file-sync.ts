/**
 * Bidirectional sync between `.flow.ts` files on disk and the embedded
 * Invect server's flow_versions DB rows.
 *
 * Two write paths share this module so the loop-prevention hashes
 * actually compose:
 *
 *   1. **Canvas → File** (express middleware):
 *      Intercept `POST /flows/:id/versions` for file-tagged flows. Emit
 *      canonical SDK source via `@flowlib/sdk` and write to disk before
 *      forwarding to the Invect router (so the DB version is still
 *      created — our policy is "DB caches the file").
 *
 *   2. **File → DB** (extension file watcher):
 *      On `onDidChange` for any `.flow.ts`, parse the file, post a new
 *      flow_version. The Invect SSE stream propagates to the canvas.
 *
 * Loop prevention: each direction records the hash of what it just
 * wrote. The other direction checks the hash before propagating; if
 * it matches, the write is the echo of our own action and gets
 * suppressed. Recency window is 5s — long enough for round-trip
 * latency, short enough that genuine user re-edits aren't suppressed.
 *
 * Hashes are SHA-256 of canonical JSON of `{ nodes, edges, metadata }`
 * (key-sorted, deep). Equivalent definitions hash identically.
 */

import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { emitSdkSource } from '@flowlib/sdk';

import { getExtensionLogger } from '../util/logger';
import { parseFlowFile } from '../flow-file/parse';

export interface FileSyncDeps {
  /**
   * Returns the file URI string backing a DB flow id, or undefined if
   * the flow isn't file-backed (DB-only / ephemeral). The InProcessBackend
   * maintains this mapping via the `__file__:<uri>` tag.
   */
  getFileUriForFlow: (flowId: string) => string | undefined;

  /**
   * Resolve a file URI to its DB flow id, creating the row if needed.
   * Used by the file watcher to find the destination of a file change.
   */
  ensureFlowForFile: (uri: vscode.Uri) => Promise<string>;

  /**
   * Post a new flow version to the embedded server. Used by the file
   * watcher to push file changes to the DB. Returns the created version
   * (or just resolves on success).
   */
  pushVersion: (flowId: string, definition: unknown) => Promise<void>;

  /**
   * Optional hook called after a successful file → DB push. The
   * extension uses this to notify open webviews that the canvas
   * should re-fetch its react-flow data — flow_version creation
   * doesn't fire on the in-process ExecutionEventBus, so without
   * this push the canvas wouldn't know to refresh.
   */
  onAfterDbPush?: (fileUri: string, flowId: string) => void;
}

interface RecentHash {
  hash: string;
  ts: number;
}

const RECENCY_MS = 5000;

export class FileSync {
  /** uri → hash of content WE just wrote to the file (canvas → file). */
  private readonly lastSelfWriteHash = new Map<string, RecentHash>();
  /** uri → hash of content WE just pushed to DB (file → DB). */
  private readonly lastDbPushHash = new Map<string, RecentHash>();

  constructor(private readonly deps: FileSyncDeps) {}

  /**
   * Hash a flow definition in a way that's INVARIANT across SDK-shape
   * (no `id`s) and DB-shape (with `id`s). Both directions of the file
   * ↔ DB sync hash with this so echo suppression works regardless of
   * which side normalised the definition first.
   *
   * The hash deliberately excludes:
   *   - node `id` (DB-only, generated on merge)
   *   - edge `id` (DB-only)
   *   - `position` (visual-only, irrelevant to flow semantics)
   * Edge endpoints are projected to `referenceId`s so the hash matches
   * whether the input expresses edges by `id` (DB) or `referenceId` (SDK).
   */
  hash(def: unknown): string {
    return crypto
      .createHash('sha256')
      .update(canonicalJson(normaliseDef(def)))
      .digest('hex');
  }

  // ── Loop-prevention recording / checking ───────────────────────────

  private recordSelfWrite(uri: string, hash: string): void {
    this.lastSelfWriteHash.set(uri, { hash, ts: Date.now() });
  }
  private recordDbPush(uri: string, hash: string): void {
    this.lastDbPushHash.set(uri, { hash, ts: Date.now() });
  }
  private isRecentSelfWrite(uri: string, hash: string): boolean {
    const e = this.lastSelfWriteHash.get(uri);
    return !!e && e.hash === hash && Date.now() - e.ts < RECENCY_MS;
  }
  private isRecentDbPush(uri: string, hash: string): boolean {
    const e = this.lastDbPushHash.get(uri);
    return !!e && e.hash === hash && Date.now() - e.ts < RECENCY_MS;
  }

  // ── Canvas → File (HTTP middleware) ────────────────────────────────

  /**
   * Express middleware. Mount BEFORE the Invect router and AFTER the
   * JSON body parser. Intercepts file-tagged flow mutations and writes
   * the new definition to disk before forwarding.
   */
  middleware(): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        // The middleware is mounted on `/flowlib`, so req.path is the
        // post-mount suffix e.g. `/flows/<id>/versions`.
        const versionsMatch =
          req.method === 'POST' ? /^\/flows\/([^/]+)\/versions\/?$/.exec(req.path) : null;
        if (versionsMatch) {
          await this.handleVersionPost(versionsMatch[1], req);
        }
      } catch (err) {
        getExtensionLogger().warn('file-sync middleware: unhandled', {
          error: (err as Error).message,
        });
      }
      next();
    };
  }

  private async handleVersionPost(flowId: string, req: Request): Promise<void> {
    const fileUri = this.deps.getFileUriForFlow(flowId);
    if (!fileUri) {
      return;
    } // DB-only flow; nothing to write.
    const def = (req.body as { invectDefinition?: unknown })?.invectDefinition;
    if (!def) {
      return;
    }
    const hash = this.hash(def);
    if (this.isRecentDbPush(fileUri, hash)) {
      // This version came FROM the file watcher — don't echo it back.
      return;
    }
    const uri = vscode.Uri.parse(fileUri);
    try {
      // Skip the write if the on-disk content is already structurally
      // equal — avoids dirtying files for no-op canvas re-renders.
      // These are content hashes, not secrets — timing-attack rule is a
      // false positive here.
      const existingHash = await this.hashFile(uri);
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (existingHash === hash) {
        return;
      }
      await this.writeFlowFile(uri, def);
      this.recordSelfWrite(fileUri, hash);
      getExtensionLogger().debug('file-sync: wrote canvas edit to file', { fileUri });
    } catch (err) {
      getExtensionLogger().warn('file-sync: write failed', {
        fileUri,
        error: (err as Error).message,
      });
    }
  }

  /** Emit canonical SDK source for `definition` and write to `uri`. */
  private async writeFlowFile(uri: vscode.Uri, definition: unknown): Promise<void> {
    const code = emitSdkSource(definition as Parameters<typeof emitSdkSource>[0]).code;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(code));
  }

  // ── File → DB (file watcher hook) ──────────────────────────────────

  /**
   * Called from the workspace file watcher's `onDidChange` /
   * `onDidCreate`. Parses the file off disk and pushes a new version.
   */
  async syncFileToDb(uri: vscode.Uri): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (err) {
      getExtensionLogger().debug('file-sync: read failed (deleted?)', {
        fileUri: uri.toString(),
        error: (err as Error).message,
      });
      return;
    }
    const src = new TextDecoder().decode(bytes);
    return this.syncTextToDb(uri, src);
  }

  /**
   * Called for in-memory text-editor edits (`onDidChangeTextDocument`).
   * Same logic as `syncFileToDb` but operates on the unsaved buffer
   * passed in directly — lets the visual canvas update live as the user
   * types in the text editor, without waiting for a save. Skips
   * silently if the source can't be parsed (mid-edit garbage).
   */
  async syncTextToDb(uri: vscode.Uri, src: string): Promise<void> {
    const fileUriStr = uri.toString();
    const result = await parseFlowFile(src, { trusted: vscode.workspace.isTrusted });
    if (!result.ok) {
      getExtensionLogger().debug('file-sync: parse failed, skipping push', {
        fileUri: fileUriStr,
        error: result.error,
      });
      return;
    }
    const def = { nodes: result.flow.nodes ?? [], edges: result.flow.edges ?? [] };
    const hash = this.hash(def);
    if (this.isRecentSelfWrite(fileUriStr, hash)) {
      // We just wrote this content via canvas-edit; don't push it back.
      return;
    }
    try {
      const flowId = await this.deps.ensureFlowForFile(uri);
      await this.deps.pushVersion(flowId, def);
      this.recordDbPush(fileUriStr, hash);
      this.deps.onAfterDbPush?.(fileUriStr, flowId);
      getExtensionLogger().debug('file-sync: pushed source to DB', {
        fileUri: fileUriStr,
        flowId,
      });
    } catch (err) {
      getExtensionLogger().warn('file-sync: pushVersion failed', {
        fileUri: fileUriStr,
        error: (err as Error).message,
      });
    }
  }

  /** Read the file and return a structural hash of its parsed definition. */
  private async hashFile(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const src = new TextDecoder().decode(bytes);
      const result = await parseFlowFile(src, { trusted: vscode.workspace.isTrusted });
      if (!result.ok) {
        return undefined;
      }
      return this.hash({ nodes: result.flow.nodes ?? [], edges: result.flow.edges ?? [] });
    } catch {
      return undefined;
    }
  }
}

/**
 * Project an SDK-parsed or DB-shape flow definition to a canonical form
 * suitable for hashing. Drops `id` (DB-only) and `position` (visual-only)
 * from each node, rewrites edge endpoints from DB `id`s to SDK
 * `referenceId`s, and sorts everything by `referenceId` so iteration
 * order doesn't affect the hash.
 *
 * Both inputs (SDK-shape: `[{ referenceId, type, params }]`; DB-shape:
 * `[{ id, referenceId, type, params, position }]`) project to the same
 * normalised structure, so equivalent flows hash identically.
 */
function normaliseDef(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const v = value as { nodes?: unknown[]; edges?: unknown[]; metadata?: unknown };
  const rawNodes = Array.isArray(v.nodes) ? v.nodes : [];
  const rawEdges = Array.isArray(v.edges) ? v.edges : [];

  const nodes = rawNodes.map((n) => {
    const node = n as Record<string, unknown>;
    // Normalise empty / missing values uniformly. SDK-shape often omits
    // the `params` key entirely; merge fills it with `{}`. Treat both
    // the same so the hash doesn't see a phantom diff.
    const params = node.params;
    return {
      referenceId:
        (node.referenceId as string | undefined) ?? (node.id as string | undefined) ?? '',
      type: node.type ?? null,
      params: params === undefined || params === null ? {} : params,
      label: node.label ?? null,
      mapper: node.mapper ?? null,
    };
  });
  // For DB-shape edges, source/target are node `id`s — project to refs.
  const idToRef = new Map<string, string>();
  for (const n of rawNodes) {
    const node = n as Record<string, unknown>;
    if (typeof node.id === 'string') {
      const ref = (node.referenceId as string | undefined) ?? (node.id as string | undefined) ?? '';
      idToRef.set(node.id, ref);
    }
  }
  const edges = rawEdges.map((e) => {
    const edge = e as Record<string, unknown>;
    const fromCandidate =
      (edge.from as string | undefined) ?? (edge.source as string | undefined) ?? '';
    const toCandidate =
      (edge.to as string | undefined) ?? (edge.target as string | undefined) ?? '';
    return {
      from: idToRef.get(fromCandidate) ?? fromCandidate,
      to: idToRef.get(toCandidate) ?? toCandidate,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    };
  });

  nodes.sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  edges.sort((a, b) =>
    `${a.from}→${a.to}|${a.sourceHandle ?? ''}|${a.targetHandle ?? ''}`.localeCompare(
      `${b.from}→${b.to}|${b.sourceHandle ?? ''}|${b.targetHandle ?? ''}`,
    ),
  );

  return { nodes, edges, metadata: v.metadata ?? null };
}

/**
 * Order-stable JSON serialiser. Sorts object keys at every depth so two
 * structurally-equal objects produce byte-identical output.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}
