import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Flowlib } from '@flowlib/ui';
import '@flowlib/ui/styles';
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { webhooks } from '@flowlib/webhooks';
import { versionControl } from '@flowlib/version-control';
import { mcp } from '@flowlib/mcp';
import { vercelWorkflowsPlugin } from '@flowlib/vercel-workflows';
// @flowlib/agents browser entry: `agents()` contributes the chat list +
// /agents route; `agentsChatFrontendPlugin` adds the /agents/sessions/:id
// chat surface.
import { agents, agentsChatFrontendPlugin } from '@flowlib/agents';

import './app.css';

export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/flowlib" replace />} />
        <Route
          path="/*"
          element={
            <div className="h-screen">
              <Flowlib
                config={{
                  apiPath: '/api/flowlib',
                  frontendPath: '/flowlib',
                  theme: 'dark',
                  plugins: [
                    auth(),
                    rbac(),
                    webhooks(),
                    versionControl(),
                    mcp(),
                    vercelWorkflowsPlugin(),
                    // Chat list + /agents route.
                    agents(),
                    // Chat surface route (/agents/sessions/:sessionId).
                    { id: 'agents-chat', name: 'Agents Chat', frontend: agentsChatFrontendPlugin },
                  ],
                }}
              />
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
