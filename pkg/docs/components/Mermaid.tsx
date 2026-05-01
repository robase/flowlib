'use client';

import { useEffect, useId, useState } from 'react';

type MermaidProps = {
  chart: string;
};

export function Mermaid({ chart }: MermaidProps) {
  const id = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'neutral',
        });

        const { svg: renderedSvg } = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg('');
          setError(
            renderError instanceof Error
              ? renderError.message
              : 'Failed to render Mermaid diagram.',
          );
        }
      }
    }

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="my-6 overflow-x-auto rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="my-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      className="my-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
