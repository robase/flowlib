'use client';

import { memo } from 'react';
import { cn } from '../../lib/utils';
import { useOptionalTheme } from '../../contexts/ThemeProvider';
import { INVECT_LOADER_DARK_SVG, INVECT_LOADER_LIGHT_SVG } from '../../assets/flowlib-branding';

export interface InvectLoaderProps {
  className?: string;
  iconClassName?: string;
  label?: string;
  labelClassName?: string;
  variant?: 'theme' | 'dark' | 'light';
}

function resolveLoaderMarkup(variant: 'theme' | 'dark' | 'light', resolvedTheme: 'dark' | 'light') {
  if (variant === 'dark') {
    return INVECT_LOADER_DARK_SVG;
  }

  if (variant === 'light') {
    return INVECT_LOADER_LIGHT_SVG;
  }

  return resolvedTheme === 'dark' ? INVECT_LOADER_DARK_SVG : INVECT_LOADER_LIGHT_SVG;
}

export const InvectLoader = memo(function InvectLoader({
  className,
  iconClassName,
  label = 'Loading...',
  labelClassName,
  variant = 'theme',
}: InvectLoaderProps) {
  const theme = useOptionalTheme();
  const resolvedTheme = theme?.resolvedTheme ?? 'light';
  const svgMarkup = resolveLoaderMarkup(variant, resolvedTheme);

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)} role="status">
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center h-12 [&>svg]:h-full [&>svg]:w-full',
          iconClassName,
        )}
        style={{ aspectRatio: '109 / 209' }}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
      {label ? (
        <span className={cn('text-sm text-muted-foreground', labelClassName)}>{label}</span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
});

InvectLoader.displayName = 'InvectLoader';
