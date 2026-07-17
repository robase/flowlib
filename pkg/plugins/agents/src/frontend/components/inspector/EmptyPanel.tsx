/**
 * EmptyPanel — shared empty / not-configured state for inspector
 * sections whose backend isn't wired up yet (Memory, Hooks).
 */
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

export function EmptyPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/40" />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
