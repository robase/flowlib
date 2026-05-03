import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PageLayoutProps {
  /** Page title shown in the header */
  title: string;
  /** Optional subtitle below the title */
  subtitle?: string;
  /** Optional Lucide icon component shown before the title */
  icon?: LucideIcon;
  /** Optional elements rendered on the right side of the header (buttons, links, etc.) */
  actions?: ReactNode;
  /** Page content */
  children: ReactNode;
  /** Max-width variant. Defaults to 'default' (max-w-6xl). */
  maxWidth?: 'sm' | 'md' | 'default' | 'full';
}

const maxWidthClasses = {
  sm: 'max-w-3xl',
  md: 'max-w-4xl',
  default: 'max-w-6xl',
  full: '',
} as const;

export const PageLayout = forwardRef<HTMLDivElement, PageLayoutProps>(function PageLayout(
  { title, subtitle, icon: Icon, actions, children, maxWidth = 'default' },
  ref,
) {
  return (
    <div
      ref={ref}
      className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground"
    >
      <div className="w-full min-h-full px-4 py-6 sm:px-6 lg:px-8">
        <div className={`mx-auto space-y-6 ${maxWidthClasses[maxWidth]}`}>
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {Icon && <Icon className="h-5 w-5 shrink-0 text-fl-primary" />}
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              </div>
              {subtitle && <p className="mt-0.5 text-sm text-fl-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>

          {/* Content */}
          {children}
        </div>
      </div>
    </div>
  );
});
