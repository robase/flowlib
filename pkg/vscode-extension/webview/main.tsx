import { createRoot } from 'react-dom/client';

// Order matters: load @flowlib/ui's stylesheet first (carries the canvas
// tokens, react-flow CSS, Tailwind utilities, the lot), then theme-bridge
// CSS overrides --imp-* tokens with VSCode equivalents at :root.
import '@flowlib/ui/styles';
import './theme-bridge.css';
import { ErrorBoundary } from './error-boundary';
import { FlowEditorApp } from './FlowEditorApp';
import { logToHost } from './vscode-bridge';

logToHost('info', 'webview script loaded', {
  href: window.location.href,
  bodyClass: document.body.className,
});

const container = document.getElementById('root');
if (!container) {
  logToHost('error', 'webview #root not found in DOM');
} else {
  logToHost('info', 'webview mounting React root');
  // No <StrictMode>: it double-mounts in dev (mount → unmount → mount),
  // and React Flow / QuickJS WASM / canvas-internal singletons don't
  // survive the cycle — the canvas paints on first mount, the unmount
  // tears down its internal refs, then the second mount silently renders
  // empty. We get the StrictMode warnings via vite/typecheck anyway.
  createRoot(container).render(
    <ErrorBoundary>
      <FlowEditorApp />
    </ErrorBoundary>,
  );
  logToHost('info', 'webview React root mounted');
}

window.addEventListener('error', (e) => {
  logToHost('error', 'webview window error', {
    message: e.message,
    filename: e.filename,
    line: e.lineno,
    col: e.colno,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  logToHost('error', 'webview unhandled rejection', {
    reason: String(e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : e.reason),
  });
});
