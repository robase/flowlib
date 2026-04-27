/**
 * Prisma Generator Tests
 *
 * Tests the Prisma schema generator for:
 *   1. New schema generation (no existing file)
 *   2. Merging into existing schema.prisma (preserves user models)
 *   3. Change detection (unchanged = code: undefined)
 *   4. Overwrite detection (existing but different = overwrite: true)
 *   5. All three providers (postgresql, mysql, sqlite)
 *   6. Plugin tables included in output
 *   7. Snapshot tests for generated output stability
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generatePrismaSchema } from '../src/generators/prisma';
import { generateSchema } from '../src/generators/index';

import {
  multiTenantPlugin,
  auditLogPlugin,
  minimalPlugin,
  ecommercePlugin,
} from './fixtures/example-schemas';

// =============================================================================
// Temp directory management
// =============================================================================

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlib-prisma-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Existing schema fixtures
// =============================================================================

const EXISTING_PG_SCHEMA = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id        String   @id @default(uuid())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`;

const EXISTING_MYSQL_SCHEMA = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Account {
  id       String @id @default(uuid())
  email    String @unique
  password String
}
`;

const EXISTING_SQLITE_SCHEMA = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Setting {
  id    String @id @default(uuid())
  key   String @unique
  value String
}
`;

// =============================================================================
// 1. New schema generation (no existing file)
// =============================================================================

describe('generatePrismaSchema — new file (no existing schema)', () => {
  it('should generate PostgreSQL schema for core-only', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    expect(result.code).toContain('model Flows');
    expect(result.code).toContain('model FlowVersions');
    expect(result.code).toContain('model FlowRuns');
    expect(result.code).toContain('provider = "postgresql"');
    expect(result.code).toContain('prisma-client-js');
    expect(result.fileName).toContain('schema.prisma');
    expect(result.overwrite).toBeFalsy();
  });

  it('should generate MySQL schema for core-only', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'mysql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    expect(result.code).toContain('model Flows');
    expect(result.code).toContain('provider = "mysql"');
  });

  it('should generate SQLite schema for core-only', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'sqlite',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    expect(result.code).toContain('model Flows');
    expect(result.code).toContain('provider = "sqlite"');
    expect(result.code).toContain('file:./dev.db');
  });

  it('should default to postgresql provider', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toContain('provider = "postgresql"');
  });

  it('should default to ./prisma/schema.prisma path', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
    });

    expect(result.fileName).toBe('./prisma/schema.prisma');
  });

  it('should include plugin tables in new schema', async () => {
    const result = await generatePrismaSchema({
      plugins: [multiTenantPlugin],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toContain('model Tenants');
    expect(result.code).toContain('model TenantMembers');
    // Plugin extends core flows table with tenantId
    expect(result.code).toContain('tenantId');
  });

  it('should include audit log plugin table', async () => {
    const result = await generatePrismaSchema({
      plugins: [auditLogPlugin],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toContain('model AuditLogs');
    expect(result.code).toContain('@@map("audit_logs")');
  });
});

// =============================================================================
// 2. Merging into existing schema.prisma
// =============================================================================

describe('generatePrismaSchema — merge into existing schema', () => {
  it('should preserve existing User model when adding Flowlib models (PostgreSQL)', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_PG_SCHEMA, 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });

    expect(result.code).toBeDefined();
    // Existing models preserved
    expect(result.code).toContain('model User');
    expect(result.code).toContain('model Post');
    expect(result.code).toContain('authorId');
    // Flowlib models added
    expect(result.code).toContain('model Flows');
    expect(result.code).toContain('model FlowVersions');
    expect(result.code).toContain('model FlowRuns');
    // Existing generator/datasource preserved
    expect(result.code).toContain('prisma-client-js');
    expect(result.code).toContain('provider = "postgresql"');
  });

  it('should preserve existing MySQL model when adding Flowlib models', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_MYSQL_SCHEMA, 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'mysql',
      file: filePath,
    });

    expect(result.code).toBeDefined();
    // Existing model preserved
    expect(result.code).toContain('model Account');
    expect(result.code).toContain('password');
    // Flowlib models added
    expect(result.code).toContain('model Flows');
  });

  it('should preserve existing SQLite model when adding Flowlib models', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_SQLITE_SCHEMA, 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'sqlite',
      file: filePath,
    });

    expect(result.code).toBeDefined();
    // Existing model preserved
    expect(result.code).toContain('model Setting');
    expect(result.code).toContain('@unique');
    // Flowlib models added
    expect(result.code).toContain('model Flows');
  });

  it('should add plugin tables alongside existing user models', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_PG_SCHEMA, 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [auditLogPlugin],
      provider: 'postgresql',
      file: filePath,
    });

    expect(result.code).toBeDefined();
    // All three categories of models present
    expect(result.code).toContain('model User'); // Existing
    expect(result.code).toContain('model Flows'); // Core
    expect(result.code).toContain('model AuditLogs'); // Plugin
  });

  it('should not duplicate models on second run', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_PG_SCHEMA, 'utf-8');

    // First run — adds Flowlib models
    const first = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });
    expect(first.code).toBeDefined();
    fs.writeFileSync(filePath, first.code!, 'utf-8');

    // Second run — should detect no changes
    const second = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });
    expect(second.code).toBeUndefined(); // No changes needed
  });
});

// =============================================================================
// 3. Change detection
// =============================================================================

describe('generatePrismaSchema — change detection', () => {
  it('should return code: undefined when file exists with same content', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');

    // First generate
    const first = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });
    expect(first.code).toBeDefined();
    fs.writeFileSync(filePath, first.code!, 'utf-8');

    // Second generate — same config
    const second = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });
    expect(second.code).toBeUndefined();
  });

  it('should return overwrite: true when file exists with different content', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, '// old schema\n', 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });

    expect(result.code).toBeDefined();
    expect(result.overwrite).toBe(true);
  });

  it('should detect changes when a plugin is added', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');

    // First run: core only
    const first = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });
    fs.writeFileSync(filePath, first.code!, 'utf-8');

    // Second run: add a plugin
    const second = await generatePrismaSchema({
      plugins: [auditLogPlugin],
      provider: 'postgresql',
      file: filePath,
    });

    expect(second.code).toBeDefined();
    expect(second.overwrite).toBe(true);
    expect(second.code).toContain('model AuditLogs');
  });
});

// =============================================================================
// 4. Router integration
// =============================================================================

describe('generateSchema (router) — prisma adapter', () => {
  it('should route to prisma adapter via generateSchema', async () => {
    const result = await generateSchema({
      adapter: 'prisma',
      provider: 'postgresql',
      plugins: [],
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    expect(result.code).toContain('model Flows');
  });

  it('should route to prisma with plugins', async () => {
    const result = await generateSchema({
      adapter: 'prisma',
      provider: 'mysql',
      plugins: [minimalPlugin],
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    expect(result.code).toContain('model Tags');
    expect(result.code).toContain('model Flows');
  });
});

// =============================================================================
// 5. Snapshot tests — output stability
// =============================================================================

describe('generatePrismaSchema — snapshots', () => {
  it('should match snapshot for core-only PostgreSQL', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    await expect(result.code).toMatchFileSnapshot('./__snapshots__/prisma-core-postgresql.txt');
  });

  it('should match snapshot for core-only MySQL', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'mysql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    await expect(result.code).toMatchFileSnapshot('./__snapshots__/prisma-core-mysql.txt');
  });

  it('should match snapshot for core-only SQLite', async () => {
    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'sqlite',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    await expect(result.code).toMatchFileSnapshot('./__snapshots__/prisma-core-sqlite.txt');
  });

  it('should match snapshot for core + ecommerce plugin (PostgreSQL)', async () => {
    const result = await generatePrismaSchema({
      plugins: [ecommercePlugin],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    await expect(result.code).toMatchFileSnapshot(
      './__snapshots__/prisma-ecommerce-postgresql.txt',
    );
  });

  it('should match snapshot for merge into existing PostgreSQL schema', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_PG_SCHEMA, 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [],
      provider: 'postgresql',
      file: filePath,
    });

    await expect(result.code).toMatchFileSnapshot(
      './__snapshots__/prisma-merge-existing-postgresql.txt',
    );
  });

  it('should match snapshot for merge with plugin into existing schema', async () => {
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, EXISTING_PG_SCHEMA, 'utf-8');

    const result = await generatePrismaSchema({
      plugins: [auditLogPlugin],
      provider: 'postgresql',
      file: filePath,
    });

    await expect(result.code).toMatchFileSnapshot(
      './__snapshots__/prisma-merge-plugin-postgresql.txt',
    );
  });
});

// =============================================================================
// 6. Prisma v7 compatibility (mirrors better-auth's Prisma v7 tests)
// =============================================================================

describe('generatePrismaSchema — Prisma v7 support', () => {
  it('should use prisma-client provider for v7+ projects', async () => {
    // Simulate a Prisma v7 project by creating a package.json
    const pkgJsonPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ dependencies: { prisma: '^7.0.0' } }));

    // Change cwd temporarily so getPrismaVersion finds the package.json
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      const result = await generatePrismaSchema({
        plugins: [],
        provider: 'postgresql',
        file: path.join(tmpDir, 'schema.prisma'),
      });

      expect(result.code).toBeDefined();
      expect(result.code).toContain('provider = "prisma-client"');
      expect(result.code).not.toContain('provider = "prisma-client-js"');
      // V7 does not include url in datasource
      expect(result.code).not.toContain('env("DATABASE_URL")');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should migrate existing v5 schema to v7 format', async () => {
    const pkgJsonPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ dependencies: { prisma: '^7.0.0' } }));

    const existingSchema = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    String @id @default(uuid())
  email String @unique
}
`;
    const filePath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(filePath, existingSchema);

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      const result = await generatePrismaSchema({
        plugins: [],
        provider: 'postgresql',
        file: filePath,
      });

      expect(result.code).toBeDefined();
      // Provider should be migrated
      expect(result.code).toContain('prisma-client');
      expect(result.code).not.toContain('prisma-client-js');
      // url should be removed for v7
      expect(result.code).not.toContain('env("DATABASE_URL")');
      // User model should be preserved
      expect(result.code).toContain('model User');
      // Flowlib models should be added
      expect(result.code).toContain('model Flows');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should use prisma-client-js for v5 projects', async () => {
    const pkgJsonPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ dependencies: { prisma: '^5.0.0' } }));

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      const result = await generatePrismaSchema({
        plugins: [],
        provider: 'postgresql',
        file: path.join(tmpDir, 'schema.prisma'),
      });

      expect(result.code).toBeDefined();
      expect(result.code).toContain('prisma-client-js');
      expect(result.code).toContain('env("DATABASE_URL")');
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// =============================================================================
// 7. Index generation
// =============================================================================

describe('generatePrismaSchema — index generation', () => {
  const indexedPlugin = {
    id: 'indexed-plugin',
    schema: {
      auditLogs: {
        tableName: 'audit_logs',
        fields: {
          id: { type: 'string', primaryKey: true },
          userId: { type: 'string', required: true, index: true },
          action: { type: 'string', required: true },
          entityId: { type: 'string', required: false, index: true },
          createdAt: { type: 'date', required: true, defaultValue: 'now()' },
        },
      },
    },
  };

  it('should generate @@index for indexed fields in new schema', async () => {
    const result = await generatePrismaSchema({
      plugins: [indexedPlugin],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    expect(result.code).toContain('@@index([userId])');
    expect(result.code).toContain('@@index([entityId])');
  });

  it('should not generate @@index for unique fields', async () => {
    const pluginWithUniqueIndex = {
      id: 'unique-index-plugin',
      schema: {
        tokens: {
          fields: {
            id: { type: 'string', primaryKey: true },
            token: { type: 'string', required: true, unique: true, index: true },
          },
        },
      },
    };

    const result = await generatePrismaSchema({
      plugins: [pluginWithUniqueIndex],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    // Should have @@unique but NOT @@index (unique already implies an index)
    expect(result.code).toContain('@@unique([token])');
    expect(result.code).not.toContain('@@index([token])');
  });
});

// =============================================================================
// 8. Unique FK → singular reverse relation
// =============================================================================

describe('generatePrismaSchema — unique FK reverse relations', () => {
  const oneToOnePlugin = {
    id: 'profile-plugin',
    schema: {
      userProfiles: {
        tableName: 'user_profiles',
        fields: {
          id: { type: 'string', primaryKey: true },
          userId: {
            type: 'string',
            required: true,
            unique: true,
            references: { table: 'flows', field: 'id', onDelete: 'cascade' },
          },
          bio: { type: 'string', required: false },
        },
      },
    },
  };

  it('should use singular optional relation for unique FK fields', async () => {
    const result = await generatePrismaSchema({
      plugins: [oneToOnePlugin],
      provider: 'postgresql',
      file: path.join(tmpDir, 'schema.prisma'),
    });

    expect(result.code).toBeDefined();
    // The Flows model should have a singular optional relation to UserProfiles, not an array
    const flowsBlock = result.code!.substring(
      result.code!.indexOf('model Flows'),
      result.code!.indexOf('}', result.code!.indexOf('model Flows')) + 1,
    );
    // Should contain UserProfiles? (singular optional), not UserProfiles[]
    expect(flowsBlock).toContain('UserProfiles?');
    expect(flowsBlock).not.toContain('UserProfiles[]');
  });
});
