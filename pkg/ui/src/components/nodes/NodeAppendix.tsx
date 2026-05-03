import { memo } from 'react';
import { MoveVertical, MoveHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';

export type AppendixPosition = 'top' | 'bottom' | 'left' | 'right';

interface NodeAppendixProps {
  position?: AppendixPosition;
  onPositionChange?: (position: AppendixPosition) => void;
  children: React.ReactNode;
  className?: string;
  /** Override the default border class (e.g. for selected/hover/state colours) */
  borderClassName?: string;
  /** Whether to show the position toggle button */
  showPositionToggle?: boolean;
}

const positionClasses: Record<AppendixPosition, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 flex-col-reverse',
  bottom: 'top-full left-1/2 -translate-x-1/2 flex-col',
  left: 'right-full top-1/2 -translate-y-1/2 flex-row-reverse',
  right: 'left-full top-1/2 -translate-y-1/2 flex-row',
};

const connectorClasses: Record<AppendixPosition, string> = {
  top: 'w-px h-4 mx-auto',
  bottom: 'w-px h-4 mx-auto',
  left: 'h-px w-4 my-auto',
  right: 'h-px w-4 my-auto',
};

const positionCycle: AppendixPosition[] = ['bottom', 'right', 'top', 'left'];

/**
 * NodeAppendix - A reusable component that renders an attached panel to a node
 *
 * Used to display additional content like tools, configurations, or previews
 * that are visually connected to a node but rendered outside its bounds.
 */
export const NodeAppendix = memo(function NodeAppendix({
  position = 'bottom',
  onPositionChange,
  children,
  className,
  borderClassName,
  showPositionToggle = true,
}: NodeAppendixProps) {
  const handlePositionToggle = () => {
    if (!onPositionChange) {
      return;
    }
    const currentIndex = positionCycle.indexOf(position);
    const nextIndex = (currentIndex + 1) % positionCycle.length;
    onPositionChange(positionCycle[nextIndex]);
  };

  const isVertical = position === 'top' || position === 'bottom';
  const ToggleIcon = isVertical ? MoveVertical : MoveHorizontal;

  const resolvedBorderClass = borderClassName || 'border-sidebar-ring';

  return (
    <div className={cn('absolute flex items-center nowheel nopan', positionClasses[position])}>
      {/* Connector line */}
      <div className={cn('bg-sidebar-ring', connectorClasses[position])} />

      {/* Content container */}
      <div
        className={cn(
          'relative rounded-lg border bg-card shadow-md nodrag transition-colors',
          resolvedBorderClass,
          className,
        )}
      >
        {/* Position toggle button */}
        {showPositionToggle && onPositionChange && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePositionToggle();
            }}
            className={cn(
              'absolute z-10 flex items-center justify-center w-5 h-5 transition-colors border rounded-full -top-2 -right-2 bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              resolvedBorderClass,
            )}
            title="Change position"
          >
            <ToggleIcon className="w-3 h-3" />
          </button>
        )}

        {children}
      </div>
    </div>
  );
});

NodeAppendix.displayName = 'NodeAppendix';
