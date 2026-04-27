/**
 * Postgres provider barrel export.
 */

export { postgresExecuteQueryAction } from './execute-query';
export { postgresListTablesAction } from './list-tables';
export { postgresDescribeTableAction } from './describe-table';
export { postgresInsertRowsAction } from './insert-rows';

import type { ActionDefinition } from '@flowlib/action-kit';
import { postgresExecuteQueryAction } from './execute-query';
import { postgresListTablesAction } from './list-tables';
import { postgresDescribeTableAction } from './describe-table';
import { postgresInsertRowsAction } from './insert-rows';

/** All Postgres actions as an array (for bulk registration). */
export const postgresActions: ActionDefinition[] = [
  postgresExecuteQueryAction,
  postgresListTablesAction,
  postgresDescribeTableAction,
  postgresInsertRowsAction,
];
