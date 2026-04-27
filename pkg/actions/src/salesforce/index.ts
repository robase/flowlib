/**
 * Salesforce provider barrel export.
 */

export { salesforceQueryAction } from './query';
export { salesforceGetRecordAction } from './get-record';
export { salesforceCreateRecordAction } from './create-record';
export { salesforceUpdateRecordAction } from './update-record';
export { salesforceListObjectsAction } from './list-objects';

import type { ActionDefinition } from '@flowlib/action-kit';
import { salesforceQueryAction } from './query';
import { salesforceGetRecordAction } from './get-record';
import { salesforceCreateRecordAction } from './create-record';
import { salesforceUpdateRecordAction } from './update-record';
import { salesforceListObjectsAction } from './list-objects';

/** All Salesforce actions as an array (for bulk registration). */
export const salesforceActions: ActionDefinition[] = [
  salesforceQueryAction,
  salesforceGetRecordAction,
  salesforceCreateRecordAction,
  salesforceUpdateRecordAction,
  salesforceListObjectsAction,
];
