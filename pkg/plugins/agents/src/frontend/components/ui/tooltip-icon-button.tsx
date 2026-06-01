/**
 * TooltipIconButton — small icon button with a native `title` tooltip.
 *
 * Kept dependency-light on purpose: no Radix Tooltip so plugin doesn't
 * pull in extra UI deps. Hosts that want richer tooltips can swap this
 * for `@flowlib/ui` primitives later.
 */
import * as React from 'react';
import { cn } from '../../lib/cn';

type Variant = 'default' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'icon';

export interface TooltipIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  variant?: Variant;
  size?: Size;
}

const sizeClasses: Record<Size, string> = {
  sm: 'size-7',
  md: 'size-8',
  icon: 'size-8',
};

const variantClasses: Record<Variant, string> = {
  default: 'bg-fl-primary text-fl-primary-foreground hover:opacity-90',
  ghost: 'bg-transparent text-fl-foreground hover:bg-fl-muted/40',
  outline: 'border border-fl-border bg-fl-background text-fl-foreground hover:bg-fl-muted/40',
};

export const TooltipIconButton = React.forwardRef<HTMLButtonElement, TooltipIconButtonProps>(
  function TooltipIconButton(
    { tooltip, side: _side, variant = 'ghost', size = 'icon', className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        title={tooltip}
        aria-label={tooltip}
        className={cn(
          'inline-flex items-center justify-center rounded-md transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-primary/50',
          '[&>svg]:size-4',
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
