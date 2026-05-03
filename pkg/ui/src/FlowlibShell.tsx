/**
 * FlowlibShell — Lightweight CSS scope + theme wrapper.
 *
 * Establishes the `.flowlib` CSS scope so that all `fl-*` theme
 * tokens and Tailwind utilities work inside it. Use this when you
 * need Flowlib theming around content that renders OUTSIDE the
 * full `<Flowlib />` component — for example, auth gates, plugin
 * UIs, or custom landing pages.
 *
 * Does NOT include routing, sidebar, API providers, or any of the
 * full Flowlib app shell. For the full app, use `<Flowlib />`.
 *
 * @example
 * ```tsx
 * import { FlowlibShell } from '@flowlib/ui';
 * import '@flowlib/ui/styles';
 *
 * function AuthPage() {
 *   return (
 *     <FlowlibShell>
 *       <MySignInForm />
 *     </FlowlibShell>
 *   );
 * }
 * ```
 */

import React, { type ReactNode } from 'react';
import { ThemeProvider } from './contexts/ThemeProvider';
import './app.css';

export interface FlowlibShellProps {
  children: ReactNode;
  /**
   * Theme mode. 'system' follows OS preference.
   * @default 'dark'
   */
  theme?: 'light' | 'dark' | 'system';
  /**
   * Additional class names on the shell container.
   */
  className?: string;
}

export const FlowlibShell = React.memo(
  ({ children, theme = 'dark', className }: FlowlibShellProps) => {
    return (
      <ThemeProvider defaultTheme={theme} storageKey="flowlib-ui-theme" className={className}>
        {children}
      </ThemeProvider>
    );
  },
);

FlowlibShell.displayName = 'FlowlibShell';
