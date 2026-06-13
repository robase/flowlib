/**
 * Webhooks Frontend Plugin — registers the sidebar item and route
 * for webhook management.
 */

import { Globe } from 'lucide-react';
import { WebhooksPage } from '../components/WebhooksPage';
import type { FlowlibFrontendPlugin } from '@flowlib/ui';

export const webhooksFrontend: FlowlibFrontendPlugin = {
  id: 'webhooks',
  name: 'Webhooks',

  sidebar: [
    {
      label: 'Webhooks',
      icon: Globe,
      path: '/webhooks',
      position: 'top',
      order: 50,
    },
  ],

  routes: [
    {
      path: '/webhooks',
      component: WebhooksPage,
    },
  ],
};
