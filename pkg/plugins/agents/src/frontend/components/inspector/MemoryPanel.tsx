/**
 * MemoryPanel — agent long-term memory.
 *
 * The memory subsystem (Mem0-pattern extraction + vector retrieval) is
 * not yet exposed via a REST endpoint, so this renders an honest
 * not-configured state rather than fabricated records.
 */
import * as React from 'react';
import { Brain } from 'lucide-react';
import { EmptyPanel } from './EmptyPanel';

export function MemoryPanel(): React.ReactElement {
  return (
    <EmptyPanel
      icon={Brain}
      title="No memory yet"
      description="Distilled facts the agent remembers across chats will appear here once memory is configured for this deployment."
    />
  );
}
