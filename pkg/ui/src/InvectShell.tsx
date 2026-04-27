/**
 * InvectShell — Lightweight CSS scope + theme wrapper.
 *
 * Establishes the `.flowlib` CSS scope so that all `imp-*` theme
 * tokens and Tailwind utilities work inside it. Use this when you
 * need Invect theming around content that renders OUTSIDE the
 * full `<Invect />` component — for example, auth gates, plugin
 * UIs, or custom landing pages.
 *
 * Does NOT include routing, sidebar, API providers, or any of the
 * full Invect app shell. For the full app, use `<Invect />`.
 *
 * @example
 * ```tsx
 * import { InvectShell } from '@flowlib/ui';
 * import '@flowlib/ui/styles';
 *
 * function AuthPage() {
 *   return (
 *     <InvectShell>
 *       <MySignInForm />
 *     </InvectShell>
 *   );
 * }
 * ```
 */

import React, { type ReactNode } from 'react';
import { ThemeProvider } from './contexts/ThemeProvider';
import './app.css';

export interface InvectShellProps {
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

export const InvectShell = React.memo(
  ({ children, theme = 'dark', className }: InvectShellProps) => {
    return (
      <ThemeProvider defaultTheme={theme} storageKey="flowlib-ui-theme" className={className}>
        {children}
      </ThemeProvider>
    );
  },
);

InvectShell.displayName = 'InvectShell';
