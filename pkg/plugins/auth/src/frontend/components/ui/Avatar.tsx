/**
 * Avatar — minimal `img + fallback initials` component.
 *
 * Hand-rolled (no Radix) to keep the auth plugin's dependency footprint small.
 * Falls back to initials on missing src or load error.
 */

import { useState } from 'react';
import { cn, getInitials } from '../../lib/utils';

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
};

export function Avatar({ src, name, email, size = 'md', className }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(name, email);
  const show = src && !errored;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground font-medium',
        SIZE_CLASSES[size],
        className,
      )}
      aria-label={name || email || 'User avatar'}
    >
      {show && src ? (
        <img
          src={src}
          alt=""
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
