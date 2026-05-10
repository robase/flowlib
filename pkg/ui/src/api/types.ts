// API client types for communicating with the Flowlib backend

import type { FlowValidationResult } from '@flowlib/core/types';
import type { NodeDefinition } from '../types/node-definition.types';

// Re-export core types used throughout the API layer
export type {
  Flow,
  FlowVersion,
  FlowRun,
  NodeExecution,
  FlowEdge,
  CreateFlowRequest,
  CreateFlowVersionRequest,
  FlowValidationResult,
  FlowValidationError,
  PaginatedResponse,
  SubmitPromptRequest,
  QueryOptions,
  FlowlibDefinition,
  Model,
  ReactFlowData,
  AgentToolDefinition,
  NodeConfigUpdateResponse,
  DashboardStats,
  FlowRunResult,
  FlowInputs,
  ExecuteFlowOptions,
  UpdateFlowInput,
} from '@flowlib/core/types';

export type { NodeDefinition };

// Custom error class for validation errors
export class ValidationError extends Error {
  public validationResult: FlowValidationResult;

  constructor(message: string, validationResult: FlowValidationResult) {
    super(message);
    this.name = 'ValidationError';
    this.validationResult = validationResult;
  }
}

// Options for React Flow data endpoint
export interface ReactFlowDataOptions {
  /** Flow version to render, or 'latest' for most recent version */
  version?: string | 'latest';
  /** Flow run ID to include execution status */
  flowRunId?: string;
}

export type CredentialAuthType =
  | 'apiKey'
  | 'bearer'
  | 'basic'
  | 'oauth2'
  | 'custom'
  | 'awsSigV4'
  | 'jwt'
  | 'connectionString';

export type CredentialType = 'http-api' | 'database' | 'llm';

export interface CredentialConfig {
  apiKey?: string;
  location?: 'header' | 'query';
  paramName?: string;
  token?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  clientId?: string;
  clientSecret?: string;
  /** OAuth2 provider ID (e.g., "google", "github") */
  oauth2Provider?: string;
  /** Authorization URL (for custom OAuth2 providers) */
  authorizationUrl?: string;
  /** Token URL (for custom OAuth2 providers) */
  tokenUrl?: string;
  headers?: Record<string, string>;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  service?: string;
  algorithm?: string;
  secret?: string;
  connectionString?: string;
  expiresAt?: string;
  apiUrl?: string;
  baseUrl?: string;
  endpoint?: string;
  [key: string]: unknown;
}

// OAuth2 Provider Definition
export interface OAuth2ProviderDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  authorizationUrl: string;
  tokenUrl: string;
  defaultScopes: string[];
  additionalAuthParams?: Record<string, string>;
  supportsRefresh: boolean;
  docsUrl?: string;
  category: 'google' | 'microsoft' | 'github' | 'slack' | 'other';
}

// OAuth2 Start Flow Result
export interface OAuth2StartResult {
  authorizationUrl: string;
  state: string;
}

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  authType: CredentialAuthType;
  config?: CredentialConfig;
  description?: string;
  isActive: boolean;
  userId: string;
  workspaceId?: string;
  isShared: boolean;
  metadata?: Record<string, unknown>;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredentialInput {
  name: string;
  type: CredentialType;
  authType: CredentialAuthType;
  config: CredentialConfig;
  description?: string;
  workspaceId?: string;
  isShared?: boolean;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface UpdateCredentialInput {
  name?: string;
  type?: CredentialType;
  authType?: CredentialAuthType;
  config?: CredentialConfig;
  description?: string;
  isActive?: boolean;
  isShared?: boolean;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface CredentialFilters {
  type?: CredentialType;
  authType?: CredentialAuthType;
  isActive?: boolean;
  includeShared?: boolean;
}

export interface CredentialUsage {
  flowsCount: number;
  nodesCount: number;
  lastUsedAt: string | null;
}

// Trigger Types
export type TriggerType = 'manual' | 'webhook' | 'cron';

export interface FlowTriggerRegistration {
  id: string;
  flowId: string;
  nodeId: string;
  type: TriggerType;
  isEnabled: boolean;
  webhookPath?: string | null;
  webhookSecret?: string | null;
  cronExpression?: string | null;
  cronTimezone?: string | null;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTriggerInput {
  nodeId: string;
  type: TriggerType;
  isEnabled?: boolean;
  webhookPath?: string;
  webhookSecret?: string;
  cronExpression?: string;
  cronTimezone?: string;
}

export interface UpdateTriggerInput {
  isEnabled?: boolean;
  webhookPath?: string;
  webhookSecret?: string;
  cronExpression?: string;
  cronTimezone?: string;
}

// =====================================
// SETTINGS
// =====================================

export interface SettingsRecord {
  key: string;
  namespace: string;
  /** Decrypted value, or `null` for sanitized secret reads. */
  value: unknown;
  encrypted: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SettingsFieldDescriptor {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'json' | 'secret';
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
  placeholder?: string;
  readOnly?: boolean;
  sensitive?: boolean;
  helpUrl?: string;
}

export interface SettingsDescriptorGroup {
  namespace: string;
  label: string;
  description?: string;
  fields: SettingsFieldDescriptor[];
}

export interface SetSettingInput {
  value: unknown;
  encrypted?: boolean;
}
