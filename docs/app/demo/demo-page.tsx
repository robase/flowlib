'use client';

import { useCallback, useEffect, useState } from 'react';
import '@flowlib/ui/styles';

type DemoFlowlibType = React.ComponentType<{ data: unknown; useMemoryRouter?: boolean }>;
type DemoData = unknown;

const DISMISSED_KEY = 'flowlib-demo-modal-dismissed';

/* -------------------------------------------------------------------------- */
/*  Info Modal                                                                 */
/* -------------------------------------------------------------------------- */

function InfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#18181b',
          border: '1px solid #27272a',
          borderRadius: 12,
          padding: '32px 36px',
          maxWidth: 520,
          width: '90%',
          color: '#e4e4e7',
          fontSize: 14,
          lineHeight: 1.7,
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#fff' }}>
          Welcome to the Flowlib demo
        </h2>
        <p style={{ margin: '0 0 16px', color: '#a1a1aa', fontSize: 13 }}>
          A live preview of the workflow editor — no backend, everything runs in your browser.
        </p>
        <ul
          style={{ margin: '0 0 24px', paddingLeft: 20, color: '#d4d4d8', listStyleType: 'disc' }}
        >
          <li>Browse flows, inspect nodes, and explore execution traces</li>
          <li>Try the AI chat panel with a pre-recorded conversation</li>
          <li>Data is read-only — creating, editing, and running flows is disabled</li>
        </ul>
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 8,
            border: 'none',
            background: '#fff',
            color: '#09090b',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  GitHub icon                                                                */
/* -------------------------------------------------------------------------- */

function GitHubIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ marginRight: 6, verticalAlign: 'text-bottom' }}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Demo Page                                                                  */
/* -------------------------------------------------------------------------- */

export function DemoPage() {
  const [DemoFlowlib, setDemoFlowlib] = useState<DemoFlowlibType | null>(null);
  const [data, setData] = useState<DemoData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // Show modal on first visit
    try {
      if (!localStorage.getItem(DISMISSED_KEY)) {
        setModalOpen(true);
      }
    } catch {
      // localStorage may be unavailable
      setModalOpen(true);
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    import('@flowlib/ui/demo').then((mod) => {
      if (cancelled) return;
      setDemoFlowlib(() => mod.DemoFlowlib as unknown as DemoFlowlibType);
      setData(mod.sampleDemoData);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!DemoFlowlib || !data) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#888',
          fontSize: 14,
        }}
      >
        Loading demo…
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: '#09090b',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 48,
          flexShrink: 0,
          padding: '0 20px',
          borderBottom: '1px solid #27272a',
          background: '#09090b',
        }}
      >
        {/* Left: back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid #27272a',
              background: 'transparent',
              color: '#a1a1aa',
              fontSize: 13,
              textDecoration: 'none',
              transition: 'color 150ms, border-color 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fafafa';
              e.currentTarget.style.borderColor = '#3f3f46';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#a1a1aa';
              e.currentTarget.style.borderColor = '#27272a';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 4 }}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </a>
          <span
            style={{ fontWeight: 600, fontSize: 15, color: '#fafafa', letterSpacing: '-0.01em' }}
          >
            Flowlib demo
          </span>
        </div>

        {/* Center: Star on GitHub */}
        <a
          href="https://github.com/robase/flowlib"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid #27272a',
            background: '#18181b',
            color: '#fafafa',
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
            transition: 'background 150ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#27272a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#18181b')}
        >
          <GitHubIcon />
          Star on GitHub
        </a>

        {/* Right: About */}
        <button
          onClick={() => setModalOpen(true)}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid #27272a',
            background: 'transparent',
            color: '#a1a1aa',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'color 150ms, border-color 150ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#fafafa';
            e.currentTarget.style.borderColor = '#3f3f46';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#a1a1aa';
            e.currentTarget.style.borderColor = '#27272a';
          }}
        >
          About
        </button>
      </header>

      {/* Inset Flowlib component — override h-screen from Flowlib root */}
      <div
        className="[&_.imp-shell]:!h-full"
        style={{
          flex: 1,
          minHeight: 0,
          margin: 12,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid #27272a',
        }}
      >
        <DemoFlowlib data={data} useMemoryRouter />
      </div>

      <InfoModal open={modalOpen} onClose={closeModal} />
    </div>
  );
}
