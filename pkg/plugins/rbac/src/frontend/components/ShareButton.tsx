/**
 * ShareButton — Header action component for the flow editor.
 *
 * Renders a "Share" button in the flow header that opens the ShareFlowModal.
 * Registered as a headerAction contribution for the 'flowHeader' context.
 */

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { useAccessibleFlows } from '../hooks/useFlowAccess';
import { useRbac } from '../providers/RbacProvider';
import { ShareFlowModal } from './ShareFlowModal';
import type { HeaderActionProps } from '../types';

export function ShareButton({ flowId }: HeaderActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { isAuthenticated, checkPermission } = useRbac();
  const { data } = useAccessibleFlows();

  if (!flowId) {
    return null;
  }

  const isAdmin = isAuthenticated && checkPermission('admin:*');
  const myPermission = isAdmin ? 'owner' : (data?.permissions?.[flowId] ?? null);

  if (myPermission !== 'owner') {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-fl-border px-3 py-1.5 text-sm font-medium text-fl-foreground transition-colors hover:border-fl-primary/50 hover:bg-fl-muted"
      >
        <Share2 className="h-4 w-4" />
        Share
      </button>
      {isOpen && <ShareFlowModal flowId={flowId} onClose={() => setIsOpen(false)} />}
    </>
  );
}
