import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://acme:acme@localhost:5432/acme_dashboard';

/**
 * Shared Drizzle database instance.
 * Used by both the Acme Dashboard app and the Flowlib integration.
 */
export const db = drizzle(connectionString, { schema });
