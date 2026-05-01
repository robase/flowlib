/**
 * SettingsCard primitives — section wrapper used on the profile/settings
 * page. Layout cribbed from
 * https://github.com/better-auth-ui/better-auth-ui (header → body →
 * action footer with right-aligned button).
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SettingsCardProps {
  title: string;
  description?: ReactNode;
  /** Body content — fields, status pills, etc. */
  children: ReactNode;
  /** Right-aligned footer (typically a save / save & continue button). */
  actions?: ReactNode;
  /** Visual emphasis — `destructive` paints the border/background red. */
  variant?: 'default' | 'destructive';
  className?: string;
}

const VARIANTS: Record<NonNullable<SettingsCardProps['variant']>, string> = {
  default: 'border-border bg-card',
  destructive: 'border-destructive/30 bg-card',
};

export function SettingsCard({
  title,
  description,
  children,
  actions,
  variant = 'default',
  className,
}: SettingsCardProps) {
  return (
    <section
      className={cn(
        'rounded-lg border text-card-foreground shadow-sm',
        VARIANTS[variant],
        className,
      )}
    >
      <header className="flex flex-col gap-1.5 p-6 pb-4">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="px-6 pb-6">{children}</div>
      {actions && (
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3 rounded-b-lg">
          {actions}
        </footer>
      )}
    </section>
  );
}
