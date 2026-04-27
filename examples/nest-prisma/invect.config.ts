/**
 * Invect Config — used by `npx flowlib-cli generate --adapter prisma`
 *
 * This file tells the CLI which plugins are active so it can merge
 * their schemas into the existing Prisma schema.
 *
 * No plugins for this example — just core Invect tables.
 */
import { defineConfig } from '@flowlib/core';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://flowlib:flowlib@localhost:5433/acme_saas';

export const invectConfig = defineConfig({
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY,
  database: {
    type: 'postgresql',
    connectionString: DATABASE_URL,
  },
  plugins: [],
});

export default invectConfig;
