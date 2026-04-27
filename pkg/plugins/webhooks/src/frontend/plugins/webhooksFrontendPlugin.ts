/**
 * Webhooks Frontend Plugin — registers the sidebar item and route
 * for webhook management.
 */

import { Globe } from 'lucide-react';
import { WebhooksPage } from '../components/WebhooksPage';
import type { InvectFrontendPlugin } from '@flowlib/ui';

export const webhooksFrontend: InvectFrontendPlugin = {
  id: 'webhooks',
  name: 'Webhooks',

  sidebar: [
    {
      label: 'Webhooks',
      icon: Globe,
      path: '/webhooks',
      position: 'top',
    },
  ],

  routes: [
    {
      path: '/webhooks',
      component: WebhooksPage,
    },
  ],
};
