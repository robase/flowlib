/**
 * Flowlib Config — used by `npx flowlib-cli generate --adapter prisma`
 *
 * This file tells the CLI which plugins are active so it can merge
 * their schemas into the existing Prisma schema.
 *
 * No plugins for this example — just core Flowlib tables.
 */
import { defineConfig } from '@flowlib/core';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://flowlib:flowlib@localhost:5433/acme_saas';

export const flowlibConfig = defineConfig({
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  database: {
    type: 'postgresql',
    connectionString: DATABASE_URL,
  },
  plugins: [],
});

export default flowlibConfig;
