// =============================================================================
// Version Control Plugin — Database Schema (abstract, dialect-agnostic)
// =============================================================================

import type { FlowlibPluginSchema } from '@flowlib/core';

const SYNC_MODES = ['direct-commit', 'pr-per-save', 'pr-per-publish'] as const;
const SYNC_DIRECTIONS = ['push', 'pull', 'bidirectional'] as const;
const SYNC_ACTIONS = ['push', 'pull', 'pr-created', 'pr-merged', 'conflict'] as const;

export const VC_SCHEMA: FlowlibPluginSchema = {
  vc_sync_config: {
    tableName: 'flowlib_vc_sync_config',
    order: 10,
    fields: {
      id: { type: 'string', primaryKey: true },
      flowId: {
        type: 'string',
        required: true,
        unique: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
        index: true,
      },
      provider: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      branch: { type: 'string', required: true },
      filePath: { type: 'string', required: true },
      mode: { type: [...SYNC_MODES], required: true },
      syncDirection: { type: [...SYNC_DIRECTIONS], required: true, defaultValue: 'push' },
      lastSyncedAt: { type: 'date', required: false },
      lastCommitSha: { type: 'string', required: false },
      lastSyncedVersion: { type: 'number', required: false },
      draftBranch: { type: 'string', required: false },
      activePrNumber: { type: 'number', required: false },
      activePrUrl: { type: 'string', required: false },
      enabled: { type: 'boolean', required: true, defaultValue: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  vc_sync_history: {
    tableName: 'flowlib_vc_sync_history',
    order: 20,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
        index: true,
      },
      action: { type: [...SYNC_ACTIONS], required: true },
      commitSha: { type: 'string', required: false },
      prNumber: { type: 'number', required: false },
      version: { type: 'number', required: false },
      message: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      createdBy: { type: 'string', required: false },
    },
  },
};
