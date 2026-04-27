/**
 * Example Schema Fixtures
 *
 * Realistic plugin schemas for different application types.
 * Used by tests to verify schema generation across all three dialects.
 *
 * Mirrors the user-auth plugin's test approach of using real-world schemas
 * (e.g., twoFactor, username, organization) to exercise the generator.
 */

import type { InvectPluginSchema } from '@flowlib/core';

// =============================================================================
// 0. User Auth — auth tables (user, session, account, verification)
//    Mirrors the schema exported by @flowlib/user-auth's USER_AUTH_SCHEMA
// =============================================================================

export const authenticationSchema: InvectPluginSchema = {
  user: {
    tableName: 'user',
    order: 1,
    fields: {
      id: { type: 'string', primaryKey: true },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true, unique: true },
      emailVerified: { type: 'boolean', required: true, defaultValue: false },
      image: { type: 'string', required: false },
      role: { type: 'string', required: false, defaultValue: 'editor' },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
  session: {
    tableName: 'session',
    order: 2,
    fields: {
      id: { type: 'string', primaryKey: true },
      expiresAt: { type: 'date', required: true },
      token: { type: 'string', required: true, unique: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
      ipAddress: { type: 'string', required: false },
      userAgent: { type: 'string', required: false },
      userId: {
        type: 'string',
        required: true,
        references: { table: 'user', field: 'id', onDelete: 'cascade' },
      },
    },
  },
  account: {
    tableName: 'account',
    order: 2,
    fields: {
      id: { type: 'string', primaryKey: true },
      accountId: { type: 'string', required: true },
      providerId: { type: 'string', required: true },
      userId: {
        type: 'string',
        required: true,
        references: { table: 'user', field: 'id', onDelete: 'cascade' },
      },
      accessToken: { type: 'string', required: false },
      refreshToken: { type: 'string', required: false },
      idToken: { type: 'string', required: false },
      accessTokenExpiresAt: { type: 'date', required: false },
      refreshTokenExpiresAt: { type: 'date', required: false },
      scope: { type: 'string', required: false },
      password: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
  verification: {
    tableName: 'verification',
    order: 2,
    fields: {
      id: { type: 'string', primaryKey: true },
      identifier: { type: 'string', required: true },
      value: { type: 'string', required: true },
      expiresAt: { type: 'date', required: true },
      createdAt: { type: 'date', required: false },
      updatedAt: { type: 'date', required: false },
    },
  },
};

export const authenticationPlugin = {
  id: 'user-auth',
  name: 'User Auth',
  schema: authenticationSchema,
  requiredTables: ['user', 'session', 'account', 'verification'],
};

// =============================================================================
// 1. SaaS Multi-Tenant — adds tenancy, billing, and user profiles
// =============================================================================

export const multiTenantSchema: InvectPluginSchema = {
  // New table: tenants
  tenants: {
    tableName: 'tenants',
    order: 5,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      name: { type: 'string', required: true },
      slug: { type: 'string', required: true, unique: true },
      plan: {
        type: ['free', 'starter', 'pro', 'enterprise'],
        required: true,
        defaultValue: 'free',
      },
      maxFlows: { type: 'number', required: true, defaultValue: 10 },
      maxRuns: { type: 'number', required: true, defaultValue: 1000 },
      isActive: { type: 'boolean', required: true, defaultValue: true },
      metadata: { type: 'json', required: false, typeAnnotation: 'Record<string, unknown>' },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // New table: tenant members
  tenantMembers: {
    tableName: 'tenant_members',
    order: 6,
    compositePrimaryKey: ['tenantId', 'userId'],
    fields: {
      tenantId: {
        type: 'uuid',
        required: true,
        references: { table: 'tenants', field: 'id', onDelete: 'cascade' },
      },
      userId: { type: 'string', required: true },
      role: {
        type: ['owner', 'admin', 'member', 'viewer'],
        required: true,
        defaultValue: 'member',
      },
      joinedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // Extend core flows table: add tenantId
  flows: {
    fields: {
      tenantId: {
        type: 'uuid',
        required: false,
        references: { table: 'tenants', field: 'id', onDelete: 'set null' },
        index: true,
      },
    },
  },
};

export const multiTenantPlugin = {
  id: 'multi-tenant',
  name: 'Multi-Tenant',
  schema: multiTenantSchema,
};

// =============================================================================
// 2. Audit Log — tracking system for compliance
// =============================================================================

export const auditLogSchema: InvectPluginSchema = {
  auditLogs: {
    tableName: 'audit_logs',
    order: 70,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      action: { type: 'string', required: true },
      resourceType: { type: 'string', required: true },
      resourceId: { type: 'string', required: true },
      actorId: { type: 'string', required: false },
      actorType: {
        type: ['user', 'system', 'api_key', 'webhook'],
        required: true,
        defaultValue: 'user',
      },
      details: { type: 'json', required: false, typeAnnotation: 'Record<string, unknown>' },
      ipAddress: { type: 'string', required: false },
      userAgent: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

export const auditLogPlugin = {
  id: 'audit-log',
  name: 'Audit Log',
  schema: auditLogSchema,
};

// =============================================================================
// 3. E-Commerce — orders, products, customers
// =============================================================================

export const ecommerceSchema: InvectPluginSchema = {
  products: {
    tableName: 'products',
    order: 70,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      name: { type: 'string', required: true },
      sku: { type: 'string', required: true, unique: true },
      description: { type: 'text', required: false },
      priceInCents: { type: 'number', required: true },
      currency: { type: 'string', required: true, defaultValue: 'USD', maxLength: 3 },
      stockQuantity: { type: 'number', required: true, defaultValue: 0 },
      isPublished: { type: 'boolean', required: true, defaultValue: false },
      tags: { type: 'json', required: false, typeAnnotation: 'string[]' },
      metadata: { type: 'json', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  customers: {
    tableName: 'customers',
    order: 70,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      email: { type: 'string', required: true, unique: true },
      name: { type: 'string', required: false },
      phone: { type: 'string', required: false },
      stripeCustomerId: { type: 'string', required: false, unique: true },
      metadata: { type: 'json', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  orders: {
    tableName: 'orders',
    order: 80,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      customerId: {
        type: 'uuid',
        required: true,
        references: { table: 'customers', field: 'id', onDelete: 'restrict' },
      },
      status: {
        type: ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'],
        required: true,
        defaultValue: 'pending',
      },
      totalInCents: { type: 'number', required: true },
      currency: { type: 'string', required: true, defaultValue: 'USD' },
      shippingAddress: { type: 'json', required: false, typeAnnotation: 'Record<string, string>' },
      notes: { type: 'text', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  orderItems: {
    tableName: 'order_items',
    order: 90,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orderId: {
        type: 'uuid',
        required: true,
        references: { table: 'orders', field: 'id', onDelete: 'cascade' },
      },
      productId: {
        type: 'uuid',
        required: true,
        references: { table: 'products', field: 'id', onDelete: 'restrict' },
      },
      quantity: { type: 'number', required: true, defaultValue: 1 },
      unitPriceInCents: { type: 'number', required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

export const ecommercePlugin = {
  id: 'ecommerce',
  name: 'E-Commerce',
  schema: ecommerceSchema,
};

// =============================================================================
// 4. Minimal — single new table, no foreign keys, no enums
// =============================================================================

export const minimalSchema: InvectPluginSchema = {
  tags: {
    tableName: 'tags',
    order: 90,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      name: { type: 'string', required: true, unique: true },
      color: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

export const minimalPlugin = {
  id: 'tags',
  name: 'Tags',
  schema: minimalSchema,
};

// =============================================================================
// 5. Core-Only Extension — only extends core tables, no new tables
// =============================================================================

export const coreExtensionSchema: InvectPluginSchema = {
  flows: {
    fields: {
      ownerId: { type: 'string', required: false },
      priority: { type: 'number', required: false, defaultValue: 0 },
      category: { type: 'string', required: false },
    },
  },
  credentials: {
    fields: {
      rotatedAt: { type: 'date', required: false },
      rotationPolicy: { type: 'string', required: false },
    },
  },
};

export const coreExtensionPlugin = {
  id: 'core-extension',
  name: 'Core Extension',
  schema: coreExtensionSchema,
};

// =============================================================================
// 6. BigInt / UUID edge-case — tests bigint columns, uuid defaults
// =============================================================================

export const analyticsSchema: InvectPluginSchema = {
  flowAnalytics: {
    tableName: 'flow_analytics',
    order: 80,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flows', field: 'id', onDelete: 'cascade' },
      },
      totalRuns: { type: 'bigint', required: true, defaultValue: 0 },
      successCount: { type: 'bigint', required: true, defaultValue: 0 },
      failureCount: { type: 'bigint', required: true, defaultValue: 0 },
      avgDurationMs: { type: 'number', required: false },
      lastRunAt: { type: 'date', required: false },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

export const analyticsPlugin = {
  id: 'analytics',
  name: 'Analytics',
  schema: analyticsSchema,
};

// =============================================================================
// 7. Conflicting Plugin — tries to redefine a core field (should fail)
// =============================================================================

export const conflictingSchema: InvectPluginSchema = {
  flows: {
    fields: {
      name: { type: 'number', required: true }, // name already exists as string in core!
    },
  },
};

export const conflictingPlugin = {
  id: 'conflicting',
  name: 'Conflicting Plugin',
  schema: conflictingSchema,
};

// =============================================================================
// 8. Disabled Migration — table that should be skipped
// =============================================================================

export const disabledMigrationSchema: InvectPluginSchema = {
  tempData: {
    tableName: 'temp_data',
    disableMigration: true,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      data: { type: 'json' },
    },
  },
  enabledTable: {
    tableName: 'enabled_table',
    order: 90,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      value: { type: 'string', required: true },
    },
  },
};

export const disabledMigrationPlugin = {
  id: 'partial-migration',
  name: 'Partial Migration',
  schema: disabledMigrationSchema,
};

// =============================================================================
// 9. Two plugins that both extend the same core table (should work)
// =============================================================================

export const pluginA = {
  id: 'plugin-a',
  name: 'Plugin A',
  schema: {
    flows: {
      fields: {
        pluginAField: { type: 'string' as const, required: false },
      },
    },
  } satisfies InvectPluginSchema,
};

export const pluginB = {
  id: 'plugin-b',
  name: 'Plugin B',
  schema: {
    flows: {
      fields: {
        pluginBField: { type: 'number' as const, required: false },
      },
    },
  } satisfies InvectPluginSchema,
};

// =============================================================================
// 10. Two plugins that CONFLICT on the same NEW field
// =============================================================================

export const conflictPluginA = {
  id: 'conflict-a',
  name: 'Conflict A',
  schema: {
    flows: {
      fields: {
        sharedField: { type: 'string' as const, required: false },
      },
    },
  } satisfies InvectPluginSchema,
};

export const conflictPluginB = {
  id: 'conflict-b',
  name: 'Conflict B',
  schema: {
    flows: {
      fields: {
        sharedField: { type: 'number' as const, required: false },
      },
    },
  } satisfies InvectPluginSchema,
};
