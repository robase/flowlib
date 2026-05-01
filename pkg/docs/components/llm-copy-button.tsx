'use client';

import { CheckIcon, CopyIcon, LoaderIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

export function LLMCopyButton({ markdownUrl }: { markdownUrl: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied'>('idle');

  const onClick = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(markdownUrl);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('idle');
    }
  }, [markdownUrl]);

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary px-3 py-1.5 text-xs font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground cursor-pointer disabled:opacity-50"
      onClick={onClick}
      disabled={state === 'loading'}
    >
      {state === 'copied' ? (
        <CheckIcon className="size-3.5" />
      ) : state === 'loading' ? (
        <LoaderIcon className="size-3.5 animate-spin" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
      Copy Markdown
    </button>
  );
}
