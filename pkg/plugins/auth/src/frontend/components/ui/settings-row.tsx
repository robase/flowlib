/**
 * Two-column settings row: title/description on the left, content on the
 * right. Layout cribbed from the user-supplied screenshot — flowlib
 * `imp-*` theming.
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SettingsRowProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsRow({ title, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-10', className)}>
      <div className="md:col-span-1">
        <h2 className="text-sm font-semibold leading-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="md:col-span-2">{children}</div>
    </div>
  );
}

export function SettingsDivider() {
  return <hr className="border-t border-border" />;
}
