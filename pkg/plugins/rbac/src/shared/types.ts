/**
 * @flowlib/rbac — Shared Types
 *
 * Serializable types shared between backend and frontend.
 * No runtime code, no React, no Node.js dependencies.
 */

// ─────────────────────────────────────────────────────────────
// Teams
// ─────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  createdAt: string;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  parentId?: string | null;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
  parentId?: string | null;
}

export interface AddTeamMemberRequest {
  userId: string;
}

export interface TeamWithMembers extends Team {
  members: TeamMember[];
}

export interface FlowSummary {
  id: string;
  name: string;
  scopeId?: string | null;
}

export interface ScopeTreeNode extends Team {
  children: ScopeTreeNode[];
  flows: FlowSummary[];
  directAccessCount: number;
  memberCount: number;
  teamPermission?: FlowAccessPermission | null;
}

export interface ScopeTreeResponse {
  scopes: ScopeTreeNode[];
  unscopedFlows: FlowSummary[];
}

// ─────────────────────────────────────────────────────────────
// Flow Access
// ─────────────────────────────────────────────────────────────

export type FlowAccessPermission = 'owner' | 'editor' | 'operator' | 'viewer';

export interface FlowAccessRecord {
  id: string;
  flowId: string;
  userId?: string | null;
  teamId?: string | null;
  permission: FlowAccessPermission;
  grantedBy?: string | null;
  grantedAt: string;
  expiresAt?: string | null;
}

export interface ScopeAccessRecord {
  id: string;
  scopeId: string;
  userId?: string | null;
  teamId?: string | null;
  permission: FlowAccessPermission;
  grantedBy?: string | null;
  grantedAt: string;
}

export interface EffectiveAccessRecord extends FlowAccessRecord {
  source: 'direct' | 'inherited';
  scopeId?: string | null;
  scopeName?: string | null;
}

export interface GrantFlowAccessRequest {
  userId?: string;
  teamId?: string;
  permission: FlowAccessPermission;
  expiresAt?: string;
}

export interface GrantScopeAccessRequest {
  userId?: string;
  teamId?: string;
  permission: FlowAccessPermission;
}

export interface AccessibleFlowsResponse {
  flowIds: string[];
  permissions: Record<string, FlowAccessPermission | null>;
  isAdmin?: boolean;
}

export interface EffectiveFlowAccessResponse {
  flowId: string;
  scopeId?: string | null;
  records: EffectiveAccessRecord[];
}

export interface MovePreviewRequest {
  type: 'flow' | 'scope';
  id: string;
  targetScopeId: string | null;
}

export interface MovePreviewAccessChange {
  userId?: string;
  teamId?: string;
  name: string;
  permission: FlowAccessPermission;
  source: string;
}

export interface MovePreviewResponse {
  item: {
    id: string;
    name: string;
    type: 'flow' | 'scope';
  };
  target: {
    id: string | null;
    name: string;
    path: string[];
  };
  affectedFlows: number;
  accessChanges: {
    gained: MovePreviewAccessChange[];
    unchanged: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Roles & Permissions (mirrors core types for frontend use)
// ─────────────────────────────────────────────────────────────

export type RolePermissionEntry = {
  role: string;
  permissions: string[];
};

// ─────────────────────────────────────────────────────────────
// Auth Me Response
// ─────────────────────────────────────────────────────────────

export interface AuthMeResponse {
  identity: {
    id: string;
    name?: string;
    role?: string;
    resolvedRole: string | null;
  } | null;
  permissions: string[];
  isAuthenticated: boolean;
}

// ─────────────────────────────────────────────────────────────
// Plugin UI Manifest Types (serializable — backend → frontend)
// ─────────────────────────────────────────────────────────────

export interface PluginUIManifest {
  sidebar?: PluginUISidebarItem[];
  pages?: PluginUIPage[];
  panelTabs?: PluginUIPanelTab[];
  headerActions?: PluginUIHeaderAction[];
}

export interface PluginUISidebarItem {
  label: string;
  /** Lucide icon name as string (e.g. 'Shield', 'Users') */
  icon: string;
  path: string;
  permission?: string;
}

export interface PluginUIPage {
  path: string;
  componentId: string;
  title?: string;
}

export interface PluginUIPanelTab {
  context: string;
  label: string;
  componentId: string;
  permission?: string;
}

export interface PluginUIHeaderAction {
  context: string;
  componentId: string;
  permission?: string;
}
