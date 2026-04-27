'use client';

import { memo } from 'react';
import { cn } from '../../lib/utils';
import { useOptionalTheme } from '../../contexts/ThemeProvider';
import { INVECT_ICON_DARK_SVG, INVECT_ICON_LIGHT_SVG } from '../../assets/flowlib-branding';

export interface InvectLogoProps {
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  showLabel?: boolean;
  label?: string;
  variant?: 'theme' | 'dark' | 'light';
}

function resolveLogoMarkup(variant: 'theme' | 'dark' | 'light', resolvedTheme: 'dark' | 'light') {
  if (variant === 'dark') {
    return INVECT_ICON_DARK_SVG;
  }

  if (variant === 'light') {
    return INVECT_ICON_LIGHT_SVG;
  }

  return resolvedTheme === 'dark' ? INVECT_ICON_DARK_SVG : INVECT_ICON_LIGHT_SVG;
}

export const InvectLogo = memo(function InvectLogo({
  className,
  iconClassName,
  labelClassName,
  showLabel = false,
  label = 'Invect',
  variant = 'theme',
}: InvectLogoProps) {
  const theme = useOptionalTheme();
  const resolvedTheme = theme?.resolvedTheme ?? 'light';
  const svgMarkup = resolveLogoMarkup(variant, resolvedTheme);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center h-6 [&>svg]:h-full [&>svg]:w-full',
          iconClassName,
        )}
        style={{ aspectRatio: '109 / 209' }}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
      {showLabel ? (
        <span className={cn('text-lg font-semibold tracking-tight', labelClassName)}>{label}</span>
      ) : null}
    </div>
  );
});

InvectLogo.displayName = 'InvectLogo';
