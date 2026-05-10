/**
 * AgentStreamContext — exposes the live chat-stream control surface
 * (permission / HIL response handlers + resolved-state maps) to
 * descendants of `<ChatThread>`.
 *
 * assistant-ui's per-part renderers receive only the `part` they
 * render — they don't get access to host-level state. The interactive
 * parts (permission requests, HIL prompts) need to call back into the
 * WS to send the user's decision, so we surface the relevant chunk
 * of `useChatStream`'s return shape via context.
 */
import * as React from 'react';

export interface AgentStreamControls {
  permissionResponse: (id: string, decision: 'allow' | 'deny') => void;
  hilResponse: (id: string, response: unknown) => void;
  resolvedPermissions: Record<string, 'allow' | 'deny'>;
  resolvedHumanInputs: Record<string, true>;
}

const AgentStreamContext = React.createContext<AgentStreamControls | null>(null);

export function AgentStreamProvider({
  controls,
  children,
}: {
  controls: AgentStreamControls;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AgentStreamContext.Provider value={controls}>{children}</AgentStreamContext.Provider>
  );
}

export function useAgentStream(): AgentStreamControls {
  const ctx = React.useContext(AgentStreamContext);
  if (!ctx) {
    throw new Error('useAgentStream must be called inside <AgentStreamProvider>');
  }
  return ctx;
}
