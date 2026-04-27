/**
 * @flowlib/vercel-workflows/ui — Frontend Plugin Entry Point
 *
 * Browser-safe entry point that exports the Vercel Workflows frontend plugin.
 * Import via: `import { vercelWorkflowsFrontendPlugin } from '@flowlib/vercel-workflows/ui'`
 */

import type { InvectFrontendPlugin } from '@flowlib/ui';
import { DeployButton } from './DeployButton';

export const vercelWorkflowsFrontendPlugin: InvectFrontendPlugin = {
  id: 'vercel-workflows',
  name: 'Vercel Workflows',
  headerActions: [{ context: 'flowHeader', component: DeployButton }],
  components: {
    'vercel-workflows.DeployButton': DeployButton as unknown as React.ComponentType<
      Record<string, unknown>
    >,
  },
};

export { DeployButton };
