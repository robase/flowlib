/**
 * AuthenticatedFlowlib — Wraps the Flowlib component with auth gating.
 *
 * Renders FlowlibShell → AuthProvider → AuthGate around Flowlib.
 * The shell establishes the `.flowlib` CSS scope so all theme tokens
 * work for both the sign-in page and the Flowlib editor.
 *
 * When the user is not authenticated, shows the sign-in page.
 * When authenticated, renders the full Flowlib UI.
 *
 * Sign-up is disabled — initial admin users are configured explicitly via
 * `authentication({ globalAdmins: [...] })`, and subsequent users are
 * created by the admin through the User Management panel.
 *
 * @example
 * ```tsx
 * import { AuthenticatedFlowlib } from '@flowlib/user-auth/ui';
 * import { Flowlib, FlowlibShell } from '@flowlib/ui';
 * import '@flowlib/ui/styles';
 *
 * export default function Page() {
 *   return (
 *     <AuthenticatedFlowlib
 *       apiBaseUrl="/api/flowlib"
 *       basePath="/flowlib"
 *       FlowlibComponent={Flowlib}
 *       ShellComponent={FlowlibShell}
 *     />
 *   );
 * }
 * ```
 */

import { type ReactNode, type ComponentType, type MemoExoticComponent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../providers/AuthProvider';
import { AuthGate } from './AuthGate';
import { SignInPage } from './SignInPage';
import { TwoFactorVerifyForm } from './TwoFactorVerifyForm';

/**
 * Accepts both a plain component and a React.memo-wrapped component.
 * React.memo returns MemoExoticComponent which isn't directly assignable
 * to ComponentType in TypeScript, but is valid in JSX.
 */
type ComponentOrMemo<P> = ComponentType<P> | MemoExoticComponent<ComponentType<P>>;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Generic over TPlugin so that passing a typed FlowlibComponent (e.g. one that
 * expects `plugins?: FlowlibFrontendPlugin[]`) causes TypeScript to infer the
 * correct element type for the `plugins` prop on AuthenticatedFlowlib itself.
 * Defaults to `unknown` for the no-plugins case.
 */
export interface AuthenticatedFlowlibProps<TPlugin = unknown> {
  /**
   * Base URL for the Flowlib API.
   * Used for both auth endpoints and the Flowlib component.
   * @example '/api/flowlib' or 'http://localhost:3000/flowlib'
   */
  apiBaseUrl?: string;
  /**
   * Base path where Flowlib is mounted in the browser.
   * @default '/flowlib'
   */
  basePath?: string;
  /**
   * The Flowlib component to render when authenticated.
   * Pass this to avoid a direct dependency on @flowlib/ui.
   * Accepts both plain and React.memo-wrapped components.
   *
   * @example
   * ```tsx
   * import { Flowlib } from '@flowlib/ui';
   * <AuthenticatedFlowlib FlowlibComponent={Flowlib} />
   * ```
   */
  FlowlibComponent: ComponentOrMemo<{
    apiBaseUrl?: string;
    basePath?: string;
    reactQueryClient?: QueryClient;
    plugins?: TPlugin[];
  }>;
  /**
   * The FlowlibShell component that provides the `.flowlib` CSS scope.
   * This ensures theme tokens work for both the sign-in page and the
   * Flowlib editor. Import from `@flowlib/ui`.
   *
   * `children` is typed as `unknown` rather than `ReactNode` to avoid a
   * structural incompatibility between `@types/react@18` (used here) and
   * `@types/react@19` (used by `@flowlib/ui`) where `ReactPortal`
   * changed between versions.
   *
   * If not provided, the auth UI renders without the Flowlib CSS scope
   * and must rely on the host app's styling.
   *
   * @example
   * ```tsx
   * import { FlowlibShell } from '@flowlib/ui';
   * <AuthenticatedFlowlib ShellComponent={FlowlibShell} />
   * ```
   */
  ShellComponent?: ComponentOrMemo<{
    children: ReactNode;
    theme?: 'light' | 'dark' | 'system';
    className?: string;
  }>;
  /**
   * Optional React Query client. If provided, it's shared between
   * the auth provider and the Flowlib component.
   */
  reactQueryClient?: QueryClient;
  /**
   * Content to display while checking session status.
   */
  loading?: ReactNode;
  /**
   * Theme for the shell wrapper.
   * @default 'system'
   */
  theme?: 'light' | 'dark' | 'system';
  /**
   * Frontend plugins forwarded to FlowlibComponent.
   * The element type is inferred from FlowlibComponent's `plugins` prop type,
   * so this stays consistent with whatever component you pass.
   *
   * @example
   * ```tsx
   * import { rbacFrontend } from '@flowlib/rbac/ui';
   * <AuthenticatedFlowlib plugins={[rbacFrontend]} />
   * ```
   */
  plugins?: TPlugin[];
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

export function AuthenticatedFlowlib<TPlugin = unknown>({
  apiBaseUrl = 'http://localhost:3000/flowlib',
  basePath = '/flowlib',
  FlowlibComponent,
  ShellComponent,
  reactQueryClient,
  loading,
  theme = 'light',
  plugins,
}: AuthenticatedFlowlibProps<TPlugin>) {
  const client = reactQueryClient ?? defaultQueryClient;
  const Flowlib = FlowlibComponent as ComponentType<{
    apiBaseUrl?: string;
    basePath?: string;
    reactQueryClient?: QueryClient;
    plugins?: TPlugin[];
  }>;
  const Shell = ShellComponent as
    | ComponentType<{
        children?: ReactNode;
        theme?: 'light' | 'dark' | 'system';
        className?: string;
      }>
    | undefined;

  const content = (
    <QueryClientProvider client={client}>
      <AuthProvider baseUrl={apiBaseUrl}>
        <AuthGate loading={loading ?? <LoadingSpinner />} fallback={<SignInOnly />}>
          <Flowlib
            apiBaseUrl={apiBaseUrl}
            basePath={basePath}
            reactQueryClient={client}
            plugins={plugins}
          />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );

  // Wrap in the shell if provided — gives us the .flowlib CSS scope
  if (Shell) {
    return (
      <Shell theme={theme} className="h-full">
        {content}
      </Shell>
    );
  }

  return content;
}

// ─────────────────────────────────────────────────────────────
// Internal: Sign-in only view (no sign-up) — with 2FA support
// ─────────────────────────────────────────────────────────────

function SignInOnly() {
  return <SignInWithTwoFactor />;
}

/**
 * Handles the sign-in → 2FA verification flow.
 * Shows sign-in form by default; switches to 2FA form when required.
 */
function SignInWithTwoFactor() {
  const { twoFactorRequired } = useAuth();

  if (twoFactorRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-imp-background p-4">
        <div className="w-full max-w-sm">
          <TwoFactorVerifyForm
            onSuccess={() => {
              // Auth state change will cause AuthGate to re-render with children
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <SignInPage
      onSuccess={() => {
        // Auth state change will cause AuthGate to re-render with children
      }}
      subtitle="Sign in to access Flowlib"
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Internal: Loading spinner
// ─────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-imp-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-imp-muted border-t-imp-primary" />
    </div>
  );
}
