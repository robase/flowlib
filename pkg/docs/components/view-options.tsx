'use client';

import { ExternalLinkIcon, SquarePenIcon } from 'lucide-react';

const btnClass =
  'inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary px-3 py-1.5 text-xs font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground';

export function ViewOptions({
  markdownUrl,
  githubUrl,
}: {
  markdownUrl: string;
  githubUrl?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <a href={markdownUrl} target="_blank" rel="noopener noreferrer" className={btnClass}>
        <ExternalLinkIcon className="size-3.5" />
        View Markdown
      </a>
      {githubUrl ? (
        <a href={githubUrl} target="_blank" rel="noopener noreferrer" className={btnClass}>
          <SquarePenIcon className="size-3.5" />
          GitHub
        </a>
      ) : null}
    </div>
  );
}
