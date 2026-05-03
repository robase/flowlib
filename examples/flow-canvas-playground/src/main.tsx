/**
 * Playground entry point — mounts `<FlowCanvas>` into a plain DOM root
 * with no `<BrowserRouter>`, no `<ApiProvider>`, no plugin registry.
 *
 * The purpose of this playground is to prove the decoupling: the
 * canvas must render and respond to edits purely from props.
 */

import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FlowCanvas } from '@flowlib/ui/flow-canvas';
import '@flowlib/ui/styles';
import type { FlowlibDefinition } from '@flowlib/core/types';
import { fixtureFlow, fixtureActions } from './fixture';

function App() {
  const [flow, setFlow] = useState<FlowlibDefinition>(fixtureFlow);
  const [tokensEnabled, setTokensEnabled] = useState(false);
  const [runStatus, setRunStatus] = useState<Record<string, 'success' | 'running' | 'failed'>>({});

  const onEdit = useCallback((next: FlowlibDefinition) => {
    setFlow(next);
  }, []);

  const onRequestRun = useCallback(
    (inputs: Record<string, unknown>) => {
      console.log('[playground] run requested with inputs', inputs);
      // Simulate a run: mark nodes running then succeeded.
      const nextStatus: Record<string, 'running'> = {};
      for (const node of flow.nodes) {
        nextStatus[node.id] = 'running';
      }
      setRunStatus(nextStatus);
      setTimeout(() => {
        const done: Record<string, 'success'> = {};
        for (const node of flow.nodes) {
          done[node.id] = 'success';
        }
        setRunStatus(done);
      }, 1200);
    },
    [flow.nodes],
  );

  const onOpenCredentialManager = useCallback(() => {
    alert('Credentials are managed in the host. (In the VSCode extension this opens the web UI.)');
  }, []);

  const tokens: Partial<Record<string, string>> | undefined = tokensEnabled
    ? { '--fl-background': '#3f2b1a' }
    : undefined;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid #333',
          background: '#111',
          color: '#eee',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <strong>FlowCanvas Playground</strong>
        <span>
          · {flow.nodes.length} nodes · {flow.edges.length} edges
        </span>
        <label style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={tokensEnabled}
            onChange={(e) => setTokensEnabled(e.target.checked)}
          />{' '}
          Override --fl-background → #3f2b1a
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <FlowCanvas
          flow={flow}
          actions={fixtureActions}
          onEdit={onEdit}
          onRequestRun={onRequestRun}
          onOpenCredentialManager={onOpenCredentialManager}
          nodeRunStatus={runStatus}
          themeTokens={tokens}
        />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('root not found');
}
createRoot(root).render(<App />);
