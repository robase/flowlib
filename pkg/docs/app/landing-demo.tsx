'use client';

import { useEffect, useState } from 'react';
import '@flowlib/ui/styles';

/**
 * Lazy-loaded FlowViewer demo for the landing page.
 * Dynamically imports @flowlib/ui/demo to avoid SSR issues
 * and keep the initial page bundle small.
 * CSS is a static import (Next.js requires this for CSS processing).
 */
export default function LandingDemo() {
  const [Demo, setDemo] = useState<React.ComponentType<{
    nodes: unknown[];
    edges: unknown[];
    nodeDefinitions: unknown[];
    agentTools?: unknown[];
    theme: string;
    interactive: boolean;
    showControls: boolean;
    className?: string;
    style?: React.CSSProperties;
  }> | null>(null);
  const [demoData, setDemoData] = useState<{
    nodes: unknown[];
    edges: unknown[];
    defs: unknown[];
    tools: unknown[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    import('@flowlib/ui/demo')
      .then((mod) => {
        if (cancelled) {
          return;
        }
        setDemo(
          () =>
            mod.FlowViewer as unknown as typeof Demo extends null
              ? never
              : NonNullable<typeof Demo>,
        );
        setDemoData({
          nodes: mod.showcaseFlowNodes,
          edges: mod.showcaseFlowEdges,
          defs: mod.sampleNodeDefinitions,
          tools: mod.showcaseAgentTools ?? [],
        });
      })
      .catch(() => {
        // Silently fail — demo is non-critical
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Demo || !demoData) {
    return (
      <div className="demo-placeholder">
        <div className="demo-placeholder-inner">Loading flow editor…</div>
      </div>
    );
  }

  return (
    <Demo
      nodes={demoData.nodes as never[]}
      edges={demoData.edges as never[]}
      nodeDefinitions={demoData.defs as never[]}
      agentTools={demoData.tools as never[]}
      theme="dark"
      interactive={false}
      showControls={false}
      style={{ width: '100%', height: '100%', borderRadius: '8px' }}
    />
  );
}
