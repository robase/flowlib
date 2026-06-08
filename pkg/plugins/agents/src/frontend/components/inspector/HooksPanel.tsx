/**
 * HooksPanel — security hooks & audit log.
 *
 * Hook handlers (path/bash denies, secret redaction) run kernel-side,
 * but audit-event persistence and a read endpoint aren't wired yet, so
 * this renders an honest not-configured state.
 */
import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { EmptyPanel } from './EmptyPanel';

export function HooksPanel(): React.ReactElement {
  return (
    <EmptyPanel
      icon={ShieldAlert}
      title="No audit events yet"
      description="Blocked tools, redacted secrets, and policy decisions will be listed here once audit persistence is enabled for this deployment."
    />
  );
}
