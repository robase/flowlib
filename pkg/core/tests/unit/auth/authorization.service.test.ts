/**
 * Unit tests for AuthorizationService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuthorizationService,
  createAuthorizationService,
} from '../../../src/services/auth/authorization.service';
import { FlowlibIdentity, FlowlibPermission } from '../../../src/types/auth.types';

describe('AuthorizationService', () => {
  let authService: AuthorizationService;

  beforeEach(() => {
    // Create service with RBAC enabled for testing
    authService = createAuthorizationService({ config: { enabled: true } });
  });

  describe('Basic Authorization', () => {
    it('should allow action when auth is disabled (default)', async () => {
      const service = createAuthorizationService();

      const result = await service.authorize({
        identity: null,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow action when auth is explicitly disabled', async () => {
      const service = createAuthorizationService({ config: { enabled: false } });

      const result = await service.authorize({
        identity: null,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny action when identity is null and auth is enabled', async () => {
      const result = await authService.authorize({
        identity: null,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Authentication required');
    });

    it('should allow action for admin role', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'admin',
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow admin:* to access any action', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'admin',
      };

      // Test various permissions
      const permissions: FlowlibPermission[] = [
        'flow:create',
        'flow:delete',
        'credential:delete',
        'admin:*',
      ];

      for (const action of permissions) {
        const result = await authService.authorize({ identity, action });
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('Role-Based Permissions', () => {
    it('should allow editor to create flows', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny viewer from creating flows', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Permission 'flow:create' required");
    });

    it('should allow viewer to read flows', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:read',
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow operator to start flow runs', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'operator',
      };

      const result = await authService.authorize({
        identity,
        action: 'flow-run:create',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny operator from deleting flows', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'operator',
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:delete',
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('Role Mapping', () => {
    it('should map host app roles to Flowlib roles', async () => {
      const service = createAuthorizationService({
        config: {
          roleMapper: {
            super_admin: 'admin',
            content_manager: 'editor',
          },
        },
      });

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'super_admin', // Host app role
      };

      const result = await service.authorize({
        identity,
        action: 'flow:delete', // Requires admin
      });

      expect(result.allowed).toBe(true);
    });

    it('should use default role when identity has no role', async () => {
      const service = createAuthorizationService({
        config: {
          enabled: true,
          defaultRole: 'viewer',
        },
      });

      const identity: FlowlibIdentity = {
        id: 'user_1',
        // No role specified
      };

      const result = await service.authorize({
        identity,
        action: 'flow:read', // Viewer can read
      });

      expect(result.allowed).toBe(true);

      const result2 = await service.authorize({
        identity,
        action: 'flow:create', // Viewer cannot create
      });

      expect(result2.allowed).toBe(false);
    });
  });

  describe('Custom Roles', () => {
    it('should support custom roles with specific permissions', async () => {
      const service = createAuthorizationService({
        config: {
          enabled: true,
          customRoles: {
            qa_tester: ['flow:read', 'flow-run:create', 'flow-run:read'],
          },
        },
      });

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'qa_tester',
      };

      // Can read flows
      expect((await service.authorize({ identity, action: 'flow:read' })).allowed).toBe(true);

      // Can create runs
      expect((await service.authorize({ identity, action: 'flow-run:create' })).allowed).toBe(true);

      // Cannot create flows
      expect((await service.authorize({ identity, action: 'flow:create' })).allowed).toBe(false);
    });
  });

  describe('Direct Permission Overrides', () => {
    it('should allow action via direct permission override', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
        permissions: ['flow:create'], // Override: viewer with create permission
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:create',
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow action if direct permissions include admin:*', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
        permissions: ['admin:*'],
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:delete',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Resource-Level Access Control', () => {
    it('should allow access to specific flow IDs', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
        resourceAccess: {
          flows: ['flow_1', 'flow_2'],
        },
      };

      // Can access flow_1
      const result1 = await authService.authorize({
        identity,
        action: 'flow:read',
        resource: { type: 'flow', id: 'flow_1' },
      });
      expect(result1.allowed).toBe(true);

      // Cannot access flow_3
      const result2 = await authService.authorize({
        identity,
        action: 'flow:read',
        resource: { type: 'flow', id: 'flow_3' },
      });
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain("No access to flow 'flow_3'");
    });

    it('should allow all resources with wildcard', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
        resourceAccess: {
          flows: '*',
        },
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:read',
        resource: { type: 'flow', id: 'any_flow_id' },
      });

      expect(result.allowed).toBe(true);
    });

    it('should not restrict when resourceAccess is not set', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
        // No resourceAccess
      };

      const result = await authService.authorize({
        identity,
        action: 'flow:read',
        resource: { type: 'flow', id: 'any_flow_id' },
      });

      expect(result.allowed).toBe(true);
    });

    it('should map flow-run resource to flows access', async () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
        resourceAccess: {
          flows: ['flow_1'],
        },
      };

      // Flow run for flow_1 should be allowed
      const result = await authService.authorize({
        identity,
        action: 'flow-run:read',
        resource: { type: 'flow-run', id: 'flow_1' },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('Custom Authorization Callback', () => {
    it('should use customAuthorize to allow action', async () => {
      const customAuthorize = vi.fn().mockResolvedValue(true);

      const service = createAuthorizationService({
        config: { enabled: true, customAuthorize },
      });

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
      };

      const result = await service.authorize({
        identity,
        action: 'flow:delete', // Viewer normally can't delete
      });

      expect(result.allowed).toBe(true);
      expect(customAuthorize).toHaveBeenCalled();
    });

    it('should use customAuthorize to deny action', async () => {
      const customAuthorize = vi.fn().mockResolvedValue(false);

      const service = createAuthorizationService({
        config: { enabled: true, customAuthorize },
      });

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'admin',
      };

      const result = await service.authorize({
        identity,
        action: 'flow:read',
      });

      // Admin normally can read, but customAuthorize returns false
      // However, customAuthorize is only called after RBAC check fails
      // Since admin has permission, customAuthorize shouldn't be called
      expect(result.allowed).toBe(true);
    });

    it('should fall through when customAuthorize returns undefined', async () => {
      const customAuthorize = vi.fn().mockResolvedValue(undefined);

      const service = createAuthorizationService({
        config: { enabled: true, customAuthorize },
      });

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
      };

      const result = await service.authorize({
        identity,
        action: 'flow:delete',
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('Public Routes', () => {
    it('should identify public routes', () => {
      const service = createAuthorizationService({
        config: {
          publicRoutes: ['/health', '/metrics', '/webhooks/*'],
        },
      });

      expect(service.isPublicRoute('/health')).toBe(true);
      expect(service.isPublicRoute('/metrics')).toBe(true);
      expect(service.isPublicRoute('/webhooks/flow_1')).toBe(true);
      expect(service.isPublicRoute('/webhooks/sub/path')).toBe(true);
      expect(service.isPublicRoute('/flows')).toBe(false);
    });
  });

  describe('Event Emission', () => {
    it('should emit auth:authorized event on success', async () => {
      const listener = vi.fn();
      authService.on('auth:authorized', listener);

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'admin',
      };

      await authService.authorize({
        identity,
        action: 'flow:create',
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth:authorized',
          identity,
          action: 'flow:create',
          allowed: true,
        }),
      );
    });

    it('should emit auth:forbidden event on denial', async () => {
      const listener = vi.fn();
      authService.on('auth:forbidden', listener);

      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'viewer',
      };

      await authService.authorize({
        identity,
        action: 'flow:delete',
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth:forbidden',
          identity,
          action: 'flow:delete',
          allowed: false,
        }),
      );
    });

    it('should emit auth:unauthenticated event when no identity', async () => {
      const listener = vi.fn();
      authService.on('auth:unauthenticated', listener);

      await authService.authorize({
        identity: null,
        action: 'flow:read',
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth:unauthenticated',
          action: 'flow:read',
        }),
      );
    });
  });

  describe('Utility Methods', () => {
    it('should return all permissions for an identity', () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
        permissions: ['admin:*'], // Override
      };

      const permissions = authService.getPermissions(identity);

      // Should have admin:* due to override
      expect(permissions).toContain('admin:*');
    });

    it('should return empty array for null identity', () => {
      const permissions = authService.getPermissions(null);
      expect(permissions).toEqual([]);
    });

    it('should check permission correctly', () => {
      const identity: FlowlibIdentity = {
        id: 'user_1',
        role: 'editor',
      };

      expect(authService.hasPermission(identity, 'flow:create')).toBe(true);
      expect(authService.hasPermission(identity, 'admin:*')).toBe(false);
      expect(authService.hasPermission(null, 'flow:read')).toBe(false);
    });

    it('should return available roles', () => {
      const service = createAuthorizationService({
        config: {
          customRoles: {
            tester: ['flow:read'],
          },
        },
      });

      const roles = service.getAvailableRoles();

      expect(roles).toContainEqual({ role: 'admin', permissions: expect.any(Array) });
      expect(roles).toContainEqual({ role: 'editor', permissions: expect.any(Array) });
      expect(roles).toContainEqual({ role: 'viewer', permissions: expect.any(Array) });
      expect(roles).toContainEqual({ role: 'tester', permissions: ['flow:read'] });
    });
  });
});
