/**
 * HubSpot provider barrel export.
 */

export { hubspotListContactsAction } from './list-contacts';
export { hubspotGetContactAction } from './get-contact';
export { hubspotCreateContactAction } from './create-contact';
export { hubspotListDealsAction } from './list-deals';
export { hubspotCreateDealAction } from './create-deal';
export { hubspotSearchObjectsAction } from './search-objects';

import type { ActionDefinition } from '@flowlib/action-kit';
import { hubspotListContactsAction } from './list-contacts';
import { hubspotGetContactAction } from './get-contact';
import { hubspotCreateContactAction } from './create-contact';
import { hubspotListDealsAction } from './list-deals';
import { hubspotCreateDealAction } from './create-deal';
import { hubspotSearchObjectsAction } from './search-objects';

/** All HubSpot actions as an array (for bulk registration). */
export const hubspotActions: ActionDefinition[] = [
  hubspotListContactsAction,
  hubspotGetContactAction,
  hubspotCreateContactAction,
  hubspotListDealsAction,
  hubspotCreateDealAction,
  hubspotSearchObjectsAction,
];
