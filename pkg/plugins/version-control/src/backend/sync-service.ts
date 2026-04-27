// =============================================================================
// Version Control Sync Service — orchestrates push/pull/publish operations
// =============================================================================

import type { GitProvider } from './git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VersionControlPluginOptions } from './types';
import type {
  VcSyncConfig,
  VcSyncHistoryRecord,
  VcSyncResult,
  VcSyncStatus,
  ConfigureSyncInput,
} from '../shared/types';
import { emitSdkSource } from '@flowlib/sdk';
import { substituteCredentialEnvs } from './credential-env-substitution';

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
}

interface FlowVersionRow {
  flow_id: string;
  version: number;
  flowlib_definition: string;
}

type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

export class VcSyncService {
  constructor(
    private provider: GitProvider,
    private options: VersionControlPluginOptions,
    private logger: Logger,
  ) {}

  // =========================================================================
  // Configuration
  // =========================================================================

  async configureSyncForFlow(
    db: PluginDatabaseApi,
    flowId: string,
    input: ConfigureSyncInput,
  ): Promise<VcSyncConfig> {
    // Check if flow exists
    const flows = await db.query<FlowRow>('SELECT id, name FROM flowlib_flows WHERE id = ?', [
      flowId,
    ]);
    if (flows.length === 0) {
      throw new Error(`Flow not found: ${flowId}`);
    }

    const flow = flows[0];
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const repo = input.repo ?? this.options.repo;
    const branch = input.branch ?? this.options.defaultBranch ?? 'main';
    const mode = input.mode ?? this.options.mode ?? 'direct-commit';
    const syncDirection = input.syncDirection ?? this.options.syncDirection ?? 'push';
    const filePath = input.filePath ?? this.buildFilePath(flow.name);

    // Upsert — delete existing config for this flow first
    await db.execute('DELETE FROM flowlib_vc_sync_config WHERE flow_id = ?', [flowId]);

    await db.execute(
      `INSERT INTO flowlib_vc_sync_config (id, flow_id, provider, repo, branch, file_path, mode, sync_direction, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, flowId, this.provider.id, repo, branch, filePath, mode, syncDirection, true, now, now],
    );

    return this.getSyncConfig(db, flowId) as Promise<VcSyncConfig>;
  }

  async getSyncConfig(db: PluginDatabaseApi, flowId: string): Promise<VcSyncConfig | null> {
    const rows = await db.query<VcSyncConfigRow>(
      'SELECT * FROM flowlib_vc_sync_config WHERE flow_id = ?',
      [flowId],
    );
    if (rows.length === 0) {
      return null;
    }
    return mapSyncConfigRow(rows[0]);
  }

  async disconnectFlow(db: PluginDatabaseApi, flowId: string): Promise<void> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      return;
    }

    // If there's an active PR, close it
    if (config.activePrNumber) {
      try {
        await this.provider.closePullRequest(
          config.repo,
          config.activePrNumber,
          'Sync disconnected — flow unlinked from version control.',
        );
      } catch (err) {
        this.logger.warn('Failed to close PR on disconnect', { error: (err as Error).message });
      }
    }

    // If there's a draft branch, try to clean it up
    if (config.draftBranch) {
      try {
        await this.provider.deleteBranch(config.repo, config.draftBranch);
      } catch {
        // Ignore — branch may already be deleted
      }
    }

    await db.execute('DELETE FROM flowlib_vc_sync_config WHERE flow_id = ?', [flowId]);
  }

  // =========================================================================
  // Push (DB → Remote)
  // =========================================================================

  async pushFlow(db: PluginDatabaseApi, flowId: string, identity?: string): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);

    if (config.syncDirection === 'pull') {
      return {
        success: false,
        error: 'Push is not allowed — this flow is configured for pull-only sync.',
        action: 'push',
      };
    }

    const { content, version } = await this.exportFlow(db, flowId);

    try {
      if (config.mode === 'direct-commit') {
        return await this.directCommit(db, config, content, version, identity);
      } else if (config.mode === 'pr-per-save') {
        return await this.commitToPrBranch(db, config, content, version, identity, true);
      } else {
        // pr-per-publish: commit to draft branch, no PR yet
        return await this.commitToDraftBranch(db, config, content, version, identity);
      }
    } catch (err) {
      const message = (err as Error).message;

      // SHA mismatch = conflict
      if (message.includes('409') || message.includes('sha')) {
        await this.recordHistory(db, flowId, 'conflict', { version, message, createdBy: identity });
        return {
          success: false,
          error: 'Conflict: remote file has changed. Use force-push or force-pull.',
          action: 'conflict',
        };
      }

      throw err;
    }
  }

  async forcePushFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);
    const { content, version } = await this.exportFlow(db, flowId);

    // Get current remote SHA (if file exists) to force update
    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);
    const sha = remote?.sha;

    const result = await this.provider.createOrUpdateFile(
      config.repo,
      config.filePath,
      content,
      `chore(flow): force-push ${this.flowFileName(config.filePath)} v${version}`,
      { branch: config.branch, sha },
    );

    await this.updateConfigAfterSync(db, flowId, result.commitSha, version);
    await this.recordHistory(db, flowId, 'push', {
      commitSha: result.commitSha,
      version,
      message: 'Force push (local wins)',
      createdBy: identity,
    });

    return { success: true, commitSha: result.commitSha, action: 'push' };
  }

  // =========================================================================
  // Pull (Remote → DB)
  // =========================================================================

  async pullFlow(db: PluginDatabaseApi, flowId: string, identity?: string): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);

    if (config.syncDirection === 'push') {
      return {
        success: false,
        error: 'Pull is not allowed — this flow is configured for push-only sync.',
        action: 'pull',
      };
    }

    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);

    if (!remote) {
      return { success: false, error: 'Remote file not found', action: 'pull' };
    }

    // Check if we're already in sync
    if (config.lastCommitSha && remote.sha === config.lastCommitSha) {
      return { success: true, action: 'pull' }; // Already up to date
    }

    await this.importFlowContent(db, flowId, remote.content, identity);
    await this.updateConfigAfterSync(db, flowId, remote.sha, null);
    await this.recordHistory(db, flowId, 'pull', {
      commitSha: remote.sha,
      message: 'Pulled from remote',
      createdBy: identity,
    });

    return { success: true, commitSha: remote.sha, action: 'pull' };
  }

  async forcePullFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    // Same as pull but ignores SHA check — always overwrites local
    const config = await this.requireConfig(db, flowId);
    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);

    if (!remote) {
      return { success: false, error: 'Remote file not found', action: 'pull' };
    }

    await this.importFlowContent(db, flowId, remote.content, identity);
    await this.updateConfigAfterSync(db, flowId, remote.sha, null);
    await this.recordHistory(db, flowId, 'pull', {
      commitSha: remote.sha,
      message: 'Force pull (remote wins)',
      createdBy: identity,
    });

    return { success: true, commitSha: remote.sha, action: 'pull' };
  }

  // =========================================================================
  // Publish (pr-per-publish mode — open PR from draft branch)
  // =========================================================================

  async publishFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);

    if (config.mode !== 'pr-per-publish') {
      return {
        success: false,
        error: 'Publish is only available in pr-per-publish mode',
        action: 'pr-created',
      };
    }

    if (!config.draftBranch) {
      return {
        success: false,
        error: 'No draft branch found — push changes first',
        action: 'pr-created',
      };
    }

    // Check if there's already an active PR
    if (config.activePrNumber) {
      const pr = await this.provider.getPullRequest(config.repo, config.activePrNumber);
      if (pr.state === 'open') {
        return {
          success: true,
          prNumber: config.activePrNumber,
          prUrl: config.activePrUrl ?? undefined,
          action: 'pr-created',
        };
      }
      // PR was closed/merged — clear it and create a new one
    }

    const fileName = this.flowFileName(config.filePath);
    const pr = await this.provider.createPullRequest(config.repo, {
      title: `feat(flow): publish ${fileName}`,
      body: `Automated PR from Flowlib — publishing flow changes for \`${fileName}\`.`,
      head: config.draftBranch,
      base: config.branch,
    });

    await db.execute(
      'UPDATE flowlib_vc_sync_config SET active_pr_number = ?, active_pr_url = ?, updated_at = ? WHERE flow_id = ?',
      [pr.number, pr.url, new Date().toISOString(), flowId],
    );

    await this.recordHistory(db, flowId, 'pr-created', {
      prNumber: pr.number,
      message: `PR #${pr.number} created`,
      createdBy: identity,
    });

    return { success: true, prNumber: pr.number, prUrl: pr.url, action: 'pr-created' };
  }

  // =========================================================================
  // Status & History
  // =========================================================================

  async getFlowSyncStatus(
    db: PluginDatabaseApi,
    flowId: string,
  ): Promise<{
    status: VcSyncStatus;
    config: VcSyncConfig | null;
    lastSync: VcSyncHistoryRecord | null;
  }> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      return { status: 'not-connected', config: null, lastSync: null };
    }

    const history = await db.query<VcSyncHistoryRow>(
      'SELECT * FROM flowlib_vc_sync_history WHERE flow_id = ? ORDER BY created_at DESC LIMIT 1',
      [flowId],
    );

    const lastSync = history.length > 0 ? mapHistoryRow(history[0]) : null;

    let status: VcSyncStatus = 'synced';
    if (!config.enabled) {
      status = 'not-connected';
    } else if (lastSync?.action === 'conflict') {
      status = 'conflict';
    } else if (!config.lastSyncedAt) {
      status = 'pending';
    } else {
      // Check if there are newer versions than what was synced
      const versions = await db.query<{ version: number }>(
        'SELECT MAX(version) as version FROM flowlib_flow_versions WHERE flow_id = ?',
        [flowId],
      );
      const latestVersion = versions[0]?.version;
      if (latestVersion && config.lastSyncedVersion && latestVersion > config.lastSyncedVersion) {
        status = 'pending';
      }
    }

    return { status, config, lastSync };
  }

  async getSyncHistory(
    db: PluginDatabaseApi,
    flowId: string,
    limit = 20,
  ): Promise<VcSyncHistoryRecord[]> {
    const rows = await db.query<VcSyncHistoryRow>(
      'SELECT * FROM flowlib_vc_sync_history WHERE flow_id = ? ORDER BY created_at DESC LIMIT ?',
      [flowId, limit],
    );
    return rows.map(mapHistoryRow);
  }

  async listSyncedFlows(
    db: PluginDatabaseApi,
  ): Promise<Array<VcSyncConfig & { flowName: string }>> {
    const rows = await db.query<VcSyncConfigRow & { flow_name: string }>(
      `SELECT flowlib_vc_sync_config.*, flowlib_flows.name as flow_name
       FROM flowlib_vc_sync_config
       JOIN flowlib_flows ON flowlib_flows.id = flowlib_vc_sync_config.flow_id
       ORDER BY flowlib_vc_sync_config.updated_at DESC`,
    );
    return rows.map((r) => ({ ...mapSyncConfigRow(r), flowName: r.flow_name }));
  }

  // =========================================================================
  // Flow deletion hook
  // =========================================================================

  async onFlowDeleted(db: PluginDatabaseApi, flowId: string): Promise<void> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      return;
    }

    // Delete the file from the remote
    try {
      const remote = await this.provider.getFileContent(
        config.repo,
        config.filePath,
        config.branch,
      );
      if (remote) {
        await this.provider.deleteFile(
          config.repo,
          config.filePath,
          `chore(flow): delete ${this.flowFileName(config.filePath)}`,
          { branch: config.branch, sha: remote.sha },
        );
        this.logger.info('Deleted flow file from remote', { flowId, filePath: config.filePath });
      }
    } catch (err) {
      this.logger.warn('Failed to delete flow file from remote', {
        flowId,
        error: (err as Error).message,
      });
    }

    // Close active PR if any
    if (config.activePrNumber) {
      try {
        await this.provider.closePullRequest(
          config.repo,
          config.activePrNumber,
          'Flow deleted — closing PR.',
        );
      } catch {
        // Ignore
      }
    }

    // Clean up draft branch
    if (config.draftBranch) {
      try {
        await this.provider.deleteBranch(config.repo, config.draftBranch);
      } catch {
        // Ignore
      }
    }

    // DB records cascade-delete from the flows FK
  }

  // =========================================================================
  // Internal — commit strategies
  // =========================================================================

  private async directCommit(
    db: PluginDatabaseApi,
    config: VcSyncConfig,
    content: string,
    version: number,
    identity?: string,
  ): Promise<VcSyncResult> {
    const sha = config.lastCommitSha ?? undefined;

    // Try to get remote SHA if we don't have one (first push)
    let remoteSha = sha;
    if (!remoteSha) {
      const remote = await this.provider.getFileContent(
        config.repo,
        config.filePath,
        config.branch,
      );
      remoteSha = remote?.sha;
    }

    const result = await this.provider.createOrUpdateFile(
      config.repo,
      config.filePath,
      content,
      `chore(flow): update ${this.flowFileName(config.filePath)} v${version}`,
      { branch: config.branch, sha: remoteSha },
    );

    await this.updateConfigAfterSync(db, config.flowId, result.commitSha, version);
    await this.recordHistory(db, config.flowId, 'push', {
      commitSha: result.commitSha,
      version,
      message: `Direct commit v${version}`,
      createdBy: identity,
    });

    return { success: true, commitSha: result.commitSha, action: 'push' };
  }

  private async commitToPrBranch(
    db: PluginDatabaseApi,
    config: VcSyncConfig,
    content: string,
    version: number,
    identity?: string,
    openPr: boolean = true,
  ): Promise<VcSyncResult> {
    const branchName = config.draftBranch ?? `flowlib/flow/${this.flowSlug(config.filePath)}`;

    // Create branch if it doesn't exist
    const existing = await this.provider.getBranch(config.repo, branchName);
    if (!existing) {
      await this.provider.createBranch(config.repo, branchName, config.branch);
    }

    // Get current file SHA on the branch
    const remote = await this.provider.getFileContent(config.repo, config.filePath, branchName);

    const result = await this.provider.createOrUpdateFile(
      config.repo,
      config.filePath,
      content,
      `chore(flow): update ${this.flowFileName(config.filePath)} v${version}`,
      { branch: branchName, sha: remote?.sha },
    );

    // Save draft branch reference
    await db.execute(
      'UPDATE flowlib_vc_sync_config SET draft_branch = ?, updated_at = ? WHERE flow_id = ?',
      [branchName, new Date().toISOString(), config.flowId],
    );

    let prNumber = config.activePrNumber ?? undefined;
    let prUrl = config.activePrUrl ?? undefined;

    // Open PR if needed
    if (openPr && !prNumber) {
      const pr = await this.provider.createPullRequest(config.repo, {
        title: `feat(flow): update ${this.flowFileName(config.filePath)}`,
        body: `Automated PR from Flowlib — flow changes for \`${this.flowFileName(config.filePath)}\`.`,
        head: branchName,
        base: config.branch,
      });
      prNumber = pr.number;
      prUrl = pr.url;

      await db.execute(
        'UPDATE flowlib_vc_sync_config SET active_pr_number = ?, active_pr_url = ?, updated_at = ? WHERE flow_id = ?',
        [prNumber, prUrl, new Date().toISOString(), config.flowId],
      );

      await this.recordHistory(db, config.flowId, 'pr-created', {
        commitSha: result.commitSha,
        prNumber,
        version,
        message: `PR #${prNumber} created`,
        createdBy: identity,
      });
    } else {
      await this.recordHistory(db, config.flowId, 'push', {
        commitSha: result.commitSha,
        version,
        message: `Updated PR branch v${version}`,
        createdBy: identity,
      });
    }

    await this.updateConfigAfterSync(db, config.flowId, result.commitSha, version);

    return {
      success: true,
      commitSha: result.commitSha,
      prNumber,
      prUrl,
      action: prNumber ? 'pr-created' : 'push',
    };
  }

  private async commitToDraftBranch(
    db: PluginDatabaseApi,
    config: VcSyncConfig,
    content: string,
    version: number,
    identity?: string,
  ): Promise<VcSyncResult> {
    // Same as PR branch commit but without opening a PR
    return this.commitToPrBranch(db, config, content, version, identity, false);
  }

  // =========================================================================
  // Internal — flow export / import
  // =========================================================================

  private async exportFlow(
    db: PluginDatabaseApi,
    flowId: string,
  ): Promise<{ content: string; version: number }> {
    const flows = await db.query<FlowRow>(
      'SELECT id, name, description, tags FROM flowlib_flows WHERE id = ?',
      [flowId],
    );
    if (flows.length === 0) {
      throw new Error(`Flow not found: ${flowId}`);
    }
    const flow = flows[0];

    const versions = await db.query<FlowVersionRow>(
      'SELECT flow_id, version, flowlib_definition FROM flowlib_flow_versions WHERE flow_id = ? ORDER BY version DESC LIMIT 1',
      [flowId],
    );
    if (versions.length === 0) {
      throw new Error(`No versions found for flow: ${flowId}`);
    }
    const fv = versions[0];

    const definition =
      typeof fv.flowlib_definition === 'string'
        ? JSON.parse(fv.flowlib_definition)
        : fv.flowlib_definition;

    let tags: string[] | undefined;
    if (flow.tags) {
      try {
        tags = typeof flow.tags === 'string' ? JSON.parse(flow.tags) : flow.tags;
      } catch {
        tags = undefined;
      }
    }

    // Flow name may contain spaces / punctuation; derive a JS-safe export
    // identifier for the emitter. Adds a `Flow` suffix only when the name
    // doesn't already end with one so exports read naturally.
    const flowName = toFlowExportName(flow.name);

    const { code } = emitSdkSource(definition, {
      flowName,
      includeJsonFooter: true,
      metadata: {
        name: flow.name,
        ...(flow.description ? { description: flow.description } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
      },
    });

    // Rewrite raw `credentialId: "cred_xxx"` refs in the human-readable
    // section to `{{env.XXX_CREDENTIAL}}` so committed flow files are
    // portable across Flowlib instances. The footer keeps the raw id for
    // authoritative round-trip on pull.
    const content = substituteCredentialEnvs(code);

    return { content, version: fv.version };
  }

  private async importFlowContent(
    db: PluginDatabaseApi,
    flowId: string,
    content: string,
    identity?: string,
  ): Promise<void> {
    // Parse the .flow.ts content statically — no eval/jiti to avoid
    // arbitrary code execution from untrusted remote files.
    const definition = parseFlowTsContent(content);

    if (
      !definition ||
      typeof definition !== 'object' ||
      !Array.isArray(definition.nodes) ||
      !Array.isArray(definition.edges)
    ) {
      throw new Error(
        'Imported .flow.ts file did not produce a valid FlowlibDefinition. ' +
          'Expected an object with "nodes" and "edges" arrays.',
      );
    }

    // Get current latest version number
    const versions = await db.query<{ version: number }>(
      'SELECT MAX(version) as version FROM flowlib_flow_versions WHERE flow_id = ?',
      [flowId],
    );
    const nextVersion = (versions[0]?.version ?? 0) + 1;

    // Insert new flow version
    const defJson = JSON.stringify(definition);

    await db.execute(
      `INSERT INTO flowlib_flow_versions (flow_id, version, flowlib_definition, created_at, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [flowId, nextVersion, defJson, new Date().toISOString(), identity ?? null],
    );

    // Update flow's live version
    await db.execute(
      'UPDATE flowlib_flows SET live_version_number = ?, updated_at = ? WHERE id = ?',
      [nextVersion, new Date().toISOString(), flowId],
    );

    this.logger.info('Flow imported from remote', {
      flowId,
      version: nextVersion,
    });
  }

  // =========================================================================
  // Internal — helpers
  // =========================================================================

  private buildFilePath(flowName: string): string {
    const basePath = this.options.path ?? 'workflows/';
    const slug = flowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${basePath}${slug}.flow.ts`;
  }

  private flowFileName(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
  }

  private flowSlug(filePath: string): string {
    const name = this.flowFileName(filePath);
    return name.replace(/\.flow\.ts$/, '');
  }

  private async requireConfig(db: PluginDatabaseApi, flowId: string): Promise<VcSyncConfig> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      throw new Error(`Flow ${flowId} is not connected to version control`);
    }
    if (!config.enabled) {
      throw new Error(`Version control sync is disabled for flow ${flowId}`);
    }
    return config;
  }

  private async updateConfigAfterSync(
    db: PluginDatabaseApi,
    flowId: string,
    commitSha: string,
    version: number | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (version !== null) {
      await db.execute(
        'UPDATE flowlib_vc_sync_config SET last_synced_at = ?, last_commit_sha = ?, last_synced_version = ?, updated_at = ? WHERE flow_id = ?',
        [now, commitSha, version, now, flowId],
      );
    } else {
      await db.execute(
        'UPDATE flowlib_vc_sync_config SET last_synced_at = ?, last_commit_sha = ?, updated_at = ? WHERE flow_id = ?',
        [now, commitSha, now, flowId],
      );
    }
  }

  private async recordHistory(
    db: PluginDatabaseApi,
    flowId: string,
    action: import('../shared/types').VcSyncAction,
    opts: {
      commitSha?: string;
      prNumber?: number;
      version?: number;
      message?: string;
      createdBy?: string;
    },
  ): Promise<void> {
    await db.execute(
      `INSERT INTO flowlib_vc_sync_history (id, flow_id, action, commit_sha, pr_number, version, message, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        flowId,
        action,
        opts.commitSha ?? null,
        opts.prNumber ?? null,
        opts.version ?? null,
        opts.message ?? null,
        new Date().toISOString(),
        opts.createdBy ?? null,
      ],
    );
  }
}

// =============================================================================
// Row mappers (snake_case DB rows → camelCase types)
// =============================================================================

interface VcSyncConfigRow {
  id: string;
  flow_id: string;
  provider: string;
  repo: string;
  branch: string;
  file_path: string;
  mode: string;
  sync_direction: string;
  last_synced_at: string | null;
  last_commit_sha: string | null;
  last_synced_version: number | null;
  draft_branch: string | null;
  active_pr_number: number | null;
  active_pr_url: string | null;
  enabled: boolean | number;
  created_at: string;
  updated_at: string;
}

interface VcSyncHistoryRow {
  id: string;
  flow_id: string;
  action: string;
  commit_sha: string | null;
  pr_number: number | null;
  version: number | null;
  message: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Convert a human-authored flow name into a JS-safe export identifier for the
 * emitter. Non-alphanumeric runs collapse to camelCase boundaries; a leading
 * digit gets an `_` prefix; empty strings fall back to `myFlow`. Adds a
 * trailing `Flow` only when the name doesn't already end in one.
 */
function toFlowExportName(raw: string): string {
  const segments = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (segments.length === 0) {
    return 'myFlow';
  }
  const camel = segments
    .map((s, i) =>
      i === 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join('');
  const base = /^[0-9]/.test(camel) ? `_${camel}` : camel;
  return /[Ff]low$/.test(base) ? base : `${base}Flow`;
}

function mapSyncConfigRow(r: VcSyncConfigRow): VcSyncConfig {
  return {
    id: r.id,
    flowId: r.flow_id,
    provider: r.provider,
    repo: r.repo,
    branch: r.branch,
    filePath: r.file_path,
    mode: r.mode as VcSyncConfig['mode'],
    syncDirection: r.sync_direction as VcSyncConfig['syncDirection'],
    lastSyncedAt: r.last_synced_at,
    lastCommitSha: r.last_commit_sha,
    lastSyncedVersion: r.last_synced_version,
    draftBranch: r.draft_branch,
    activePrNumber: r.active_pr_number,
    activePrUrl: r.active_pr_url,
    enabled: r.enabled === true || r.enabled === 1,
  };
}

function mapHistoryRow(r: VcSyncHistoryRow): VcSyncHistoryRecord {
  return {
    id: r.id,
    flowId: r.flow_id,
    action: r.action as VcSyncHistoryRecord['action'],
    commitSha: r.commit_sha,
    prNumber: r.pr_number,
    version: r.version,
    message: r.message,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

// =============================================================================
// Static .flow.ts parser — extracts definition without eval
// =============================================================================

/**
 * Parse a .flow.ts file content to extract the FlowlibDefinition.
 *
 * This is a static parser that does NOT evaluate the TypeScript file.
 * It works by extracting the `defineFlow({ ... })` call's argument as a
 * JS object literal string and parsing it with a safe JSON5-like approach.
 *
 * Falls back to extracting raw `nodes` and `edges` arrays if defineFlow
 * wrapper is not found.
 */
export function parseFlowTsContent(content: string): { nodes: unknown[]; edges: unknown[] } | null {
  // Strategy 1 (preferred): Look for the embedded JSON block comment.
  // The serializer embeds `/* @flowlib-definition {...} */` for reliable round-tripping.
  const jsonCommentMatch = content.match(/\/\*\s*@flowlib-definition\s+([\s\S]*?)\s*\*\//);
  if (jsonCommentMatch) {
    try {
      return JSON.parse(jsonCommentMatch[1]);
    } catch {
      // Fall through to strategy 2
    }
  }

  // Strategy 2 (fallback): Extract the defineFlow({ ... }) argument.
  // Used for hand-written or older .flow.ts files without the JSON comment.
  const defineFlowMatch = content.match(/defineFlow\s*\(\s*\{/);
  if (defineFlowMatch && defineFlowMatch.index !== undefined) {
    const startIdx = defineFlowMatch.index + defineFlowMatch[0].length - 1; // { position
    const objStr = extractBalancedBraces(content, startIdx);
    if (objStr) {
      try {
        const parsed = parseObjectLiteral(objStr);
        if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          return { nodes: parsed.nodes, edges: parsed.edges };
        }
      } catch {
        // Fall through
      }
    }
  }

  return null;
}

/** Extract a balanced {} block from a string starting at the given { index */
function extractBalancedBraces(str: string, startIdx: number): string | null {
  let depth = 0;
  let inString: string | false = false;
  let escaped = false;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === inString) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse a JS object literal string into a JSON-compatible value.
 *
 * Handles: unquoted keys, single-quoted strings, trailing commas,
 * template literals (simplified), and function calls by converting
 * them to strings.
 */
function parseObjectLiteral(objStr: string): Record<string, unknown> | null {
  try {
    // Normalize JS object literal to JSON:
    // 1. Strip single-line comments
    let normalized = objStr.replace(/\/\/.*$/gm, '');
    // 2. Strip multi-line comments
    normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
    // 3. Replace single quotes with double quotes (outside existing double quotes)
    normalized = replaceQuotes(normalized);
    // 4. Quote unquoted keys
    normalized = normalized.replace(/(?<=[{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g, '"$1"');
    // 5. Remove trailing commas before } or ]
    normalized = normalized.replace(/,\s*([}\]])/g, '$1');
    // 6. Replace function calls like input("ref", {...}) with a placeholder string
    // This handles the helper calls in the nodes array
    normalized = replaceFunctionCalls(normalized);

    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

/** Replace single-quoted strings with double-quoted */
function replaceQuotes(str: string): string {
  let result = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      result += ch;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      result += '"';
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * Replace function calls like `input("ref", { ... })` with a JSON object
 * that captures the node structure. This handles the SDK helper calls
 * in the serialized .flow.ts nodes array.
 *
 * Pattern: `helperName("refId", { params })` → `{ "type": "helperName", "referenceId": "refId", "params": { ... } }`
 * Also handles namespaced: `ns.helperName("refId", { ... })`
 */
function replaceFunctionCalls(str: string): string {
  // Match function calls: word.word( or word( at the start of array items
  const callPattern =
    /([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*|[a-zA-Z_$][\w$]*)\s*\(\s*"([^"]*)"\s*,\s*(\{)/g;

  let result = str;
  let match: RegExpExecArray | null;
  let offset = 0;

  // Reset lastIndex
  callPattern.lastIndex = 0;

  while ((match = callPattern.exec(str)) !== null) {
    const fnName = match[1];
    const refId = match[2];
    const braceStart = match.index + match[0].length - 1;

    const paramsBlock = extractBalancedBraces(str, braceStart);
    if (!paramsBlock) {
      continue;
    }

    // Find the closing ) after the params block
    const afterParams = braceStart + paramsBlock.length;
    let closeParen = afterParams;
    while (closeParen < str.length && str[closeParen] !== ')') {
      closeParen++;
    }

    const fullCall = str.slice(match.index, closeParen + 1);
    const replacement = `{ "__type": "${fnName}", "referenceId": "${refId}", "params": ${paramsBlock} }`;

    result =
      result.slice(0, match.index + offset) +
      replacement +
      result.slice(match.index + offset + fullCall.length);

    offset += replacement.length - fullCall.length;
  }

  return result;
}
