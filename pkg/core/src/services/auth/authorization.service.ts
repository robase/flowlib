/**
 * Authorization Service
 *
 * Handles RBAC (Role-Based Access Control) for Flowlib resources.
 * This service is stateless - all identity information comes from the host app
 * via the resolveUser callback at request time.
 */

import { EventEmitter } from 'events';
import {
  FlowlibIdentity,
  FlowlibPermission,
  FlowlibRole,
  FlowlibResourceType,
  FlowlibAuthConfig,
  AuthorizationContext,
  AuthorizationResult,
  AuthAuthorizedEvent,
  AuthForbiddenEvent,
  AuthUnauthenticatedEvent,
  AuthEvent,
  DEFAULT_ROLE_PERMISSIONS,
} from '../../types/auth.types';
import type { Logger } from '../../schemas/flowlib-config';

/**
 * Options for creating the AuthorizationService
 */
export interface AuthorizationServiceOptions {
  config?: FlowlibAuthConfig;
  logger?: Logger;
}

/**
 * AuthorizationService - Stateless RBAC authorization for Flowlib
 *
 * Key design decisions:
 * - No database tables for users/roles (BYO Auth pattern)
 * - All identity information resolved at request time
 * - Emits events for host app audit logging
 * - Supports custom roles and permission overrides
 *
 * Currently extends Node's `EventEmitter` for back-compat with existing
 * `service.on('auth:authorized', ...)` callers. New code should prefer the
 * abstract `onChange(handler)` method below: it returns an idempotent
 * disposer, doesn't depend on `EventEmitter`, and is the surface that
 * out-of-process auth-event adapters (mirror of `RemoteEventBus`) implement.
 */
export class AuthorizationService extends EventEmitter {
  private readonly config: FlowlibAuthConfig;
  private readonly rolePermissions: Map<string, FlowlibPermission[]>;
  private readonly logger?: Logger;

  constructor(options: AuthorizationServiceOptions = {}) {
    super();

    this.config = {
      enabled: false, // RBAC disabled by default
      defaultRole: 'viewer',
      onAuthFailure: 'throw',
      ...options.config,
    };

    this.logger = options.logger;

    // Initialize role → permissions map with defaults + custom roles
    this.rolePermissions = new Map();

    // Add built-in roles
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      this.rolePermissions.set(role, permissions);
    }

    // Add custom roles from config
    if (this.config.customRoles) {
      for (const [role, permissions] of Object.entries(this.config.customRoles)) {
        this.rolePermissions.set(role, permissions);
      }
    }
  }

  /**
   * Check if authentication is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }

  /**
   * Check if a route is public (no auth required).
   */
  isPublicRoute(path: string): boolean {
    if (!this.config.publicRoutes) {
      return false;
    }

    return this.config.publicRoutes.some((pattern) => {
      // Support simple wildcard matching
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        return path.startsWith(prefix);
      }
      return path === pattern;
    });
  }

  /**
   * Authorize an action for an identity.
   *
   * @param context - Authorization context with identity, action, and optional resource
   * @returns Authorization result with allowed flag and optional reason
   */
  async authorize(context: AuthorizationContext): Promise<AuthorizationResult> {
    const { identity, action, resource } = context;

    // If auth is disabled, allow everything
    if (!this.isEnabled()) {
      this.logger?.debug('Auth disabled, allowing action', { action });
      return { allowed: true };
    }

    // No identity = not authenticated
    if (!identity) {
      const event: AuthUnauthenticatedEvent = {
        type: 'auth:unauthenticated',
        timestamp: new Date(),
        action,
        resource,
      };
      this.emit('auth:unauthenticated', event);
      this.logger?.warn('Unauthenticated request', { action, resource });

      return {
        allowed: false,
        reason: 'Authentication required',
      };
    }

    // Check direct permission overrides first
    if (this.hasDirectPermission(identity, action)) {
      return this.allowAction(context, 'direct permission');
    }

    // Check role-based permissions
    const role = this.resolveRole(identity);
    const permissions = this.getPermissionsForRole(role);

    if (this.permissionMatches(permissions, action)) {
      // If we have permission, also check resource-level access
      if (resource?.id && identity.resourceAccess) {
        const resourceAllowed = this.checkResourceAccess(identity, resource);
        if (!resourceAllowed) {
          return this.denyAction(context, `No access to ${resource.type} '${resource.id}'`);
        }
      }
      return this.allowAction(context, `role '${role}'`);
    }

    // Check custom authorization callback
    if (this.config.customAuthorize) {
      try {
        const customResult = await this.config.customAuthorize(context);
        if (customResult === true) {
          return this.allowAction(context, 'custom authorizer');
        }
        if (customResult === false) {
          return this.denyAction(context, 'Denied by custom authorizer');
        }
        // undefined = fall through to default denial
      } catch (error) {
        this.logger?.error('Custom authorizer error', { error, context });
        // On error, fall through to denial
      }
    }

    // Default: deny
    return this.denyAction(
      context,
      `Permission '${action}' required. Role '${role}' does not have this permission.`,
    );
  }

  /**
   * Get all permissions for an identity.
   */
  getPermissions(identity: FlowlibIdentity | null): FlowlibPermission[] {
    if (!identity) {
      return [];
    }

    const role = this.resolveRole(identity);
    const rolePerms = this.getPermissionsForRole(role);
    const directPerms = identity.permissions || [];

    // Combine and deduplicate
    const allPerms = new Set([...rolePerms, ...directPerms]);

    // If admin:*, expand to all permissions
    if (allPerms.has('admin:*')) {
      return ['admin:*'];
    }

    return Array.from(allPerms);
  }

  /**
   * Check if identity has a specific permission.
   */
  hasPermission(identity: FlowlibIdentity | null, permission: FlowlibPermission): boolean {
    if (!identity) {
      return false;
    }

    const permissions = this.getPermissions(identity);
    return this.permissionMatches(permissions, permission);
  }

  /**
   * Get the resolved role for an identity.
   */
  getResolvedRole(identity: FlowlibIdentity): FlowlibRole {
    return this.resolveRole(identity);
  }

  /**
   * Subscribe to authorization-state changes (`auth:authorized`,
   * `auth:forbidden`, `auth:unauthenticated`).
   *
   * Future-proof alternative to `service.on('auth:authorized', …)`. Returns
   * an idempotent disposer — calling it more than once is a no-op. New code
   * should prefer this over the inherited `EventEmitter` API; the latter
   * remains supported for back-compat but will become an implementation
   * detail of an `AuthEventBusAdapter` in a future PR.
   */
  onChange(handler: (event: AuthEvent) => void): () => void {
    const forward = (event: AuthEvent) => handler(event);
    this.on('auth:authorized', forward);
    this.on('auth:forbidden', forward);
    this.on('auth:unauthenticated', forward);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      this.off('auth:authorized', forward);
      this.off('auth:forbidden', forward);
      this.off('auth:unauthenticated', forward);
    };
  }

  /**
   * Get available roles and their permissions.
   * Useful for admin UIs to show role options.
   */
  getAvailableRoles(): Array<{ role: string; permissions: FlowlibPermission[] }> {
    const roles: Array<{ role: string; permissions: FlowlibPermission[] }> = [];

    for (const [role, permissions] of this.rolePermissions) {
      roles.push({ role, permissions });
    }

    return roles;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Resolve the effective Flowlib role for an identity.
   */
  private resolveRole(identity: FlowlibIdentity): string {
    const identityRole = identity.role;

    // No role provided - use default
    if (!identityRole) {
      return this.config.defaultRole ?? 'viewer';
    }

    // Check if role needs mapping
    if (this.config.roleMapper && this.config.roleMapper[identityRole]) {
      return this.config.roleMapper[identityRole];
    }

    return identityRole;
  }

  /**
   * Get permissions for a role.
   */
  private getPermissionsForRole(role: string): FlowlibPermission[] {
    return this.rolePermissions.get(role) || [];
  }

  /**
   * Check if identity has the permission via direct override.
   */
  private hasDirectPermission(identity: FlowlibIdentity, action: FlowlibPermission): boolean {
    if (!identity.permissions) {
      return false;
    }
    return this.permissionMatches(identity.permissions, action);
  }

  /**
   * Check if a permission list includes the required permission.
   * Handles admin:* wildcard.
   */
  private permissionMatches(permissions: FlowlibPermission[], required: FlowlibPermission): boolean {
    // Admin wildcard grants everything
    if (permissions.includes('admin:*')) {
      return true;
    }
    return permissions.includes(required);
  }

  /**
   * Check resource-level access control.
   */
  private checkResourceAccess(
    identity: FlowlibIdentity,
    resource: { type: FlowlibResourceType; id?: string },
  ): boolean {
    if (!identity.resourceAccess || !resource.id) {
      return true; // No restriction
    }

    // Map resource type to resourceAccess key
    const accessKey = this.getResourceAccessKey(resource.type);
    if (!accessKey) {
      return true; // Unknown resource type, allow
    }

    const accessList = identity.resourceAccess[accessKey];

    // No restriction for this resource type
    if (accessList === undefined) {
      return true;
    }

    // Wildcard allows all
    if (accessList === '*') {
      return true;
    }

    // Check if resource ID is in the list
    return accessList.includes(resource.id);
  }

  /**
   * Map resource type to resourceAccess property key.
   */
  private getResourceAccessKey(
    type: FlowlibResourceType,
  ): keyof NonNullable<FlowlibIdentity['resourceAccess']> | null {
    switch (type) {
      case 'flow':
      case 'flow-version':
      case 'flow-run':
      case 'node-execution':
        return 'flows';
      case 'credential':
        return 'credentials';
      case 'agent-tool':
        return null; // No resource-level restriction for tools
      default:
        return null;
    }
  }

  /**
   * Allow an action and emit event.
   */
  private allowAction(context: AuthorizationContext, grantedBy: string): AuthorizationResult {
    const event: AuthAuthorizedEvent = {
      type: 'auth:authorized',
      timestamp: new Date(),
      identity: context.identity,
      action: context.action,
      resource: context.resource,
      allowed: true,
    };

    this.emit('auth:authorized', event);
    this.logger?.debug('Action authorized', {
      action: context.action,
      resource: context.resource,
      grantedBy,
      identity: context.identity?.id,
    });

    return { allowed: true };
  }

  /**
   * Deny an action and emit event.
   */
  private denyAction(context: AuthorizationContext, reason: string): AuthorizationResult {
    const event: AuthForbiddenEvent = {
      type: 'auth:forbidden',
      timestamp: new Date(),
      identity: context.identity,
      action: context.action,
      resource: context.resource,
      allowed: false,
      reason,
    };

    this.emit('auth:forbidden', event);
    this.logger?.warn('Action denied', {
      action: context.action,
      resource: context.resource,
      reason,
      identity: context.identity?.id,
      role: context.identity?.role,
    });

    return { allowed: false, reason };
  }
}

/**
 * Create an AuthorizationService instance.
 */
export function createAuthorizationService(
  options?: AuthorizationServiceOptions,
): AuthorizationService {
  return new AuthorizationService(options);
}
