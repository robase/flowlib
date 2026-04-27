/**
 * SignInPage — Full-page sign-in component with layout.
 *
 * Renders the SignInForm centered on the page with a logo, title,
 * and grouped fields matching the Flowlib design system.
 * Sign-up is not offered — new users are created by admins.
 */

import { SignInForm } from './SignInForm';

export interface SignInPageProps {
  /** Called after successful sign-in */
  onSuccess?: () => void;
  /** Called when user clicks "Sign Up" link (optional — hidden if omitted) */
  onNavigateToSignUp?: () => void;
  /** Page title */
  title?: string;
  /** Page subtitle */
  subtitle?: string;
}

export function SignInPage({
  onSuccess,
  onNavigateToSignUp,
  title = 'Welcome back',
  subtitle = 'Sign in to your account to continue',
}: SignInPageProps) {
  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-imp-background text-imp-foreground">
      <div className="flex flex-col w-full max-w-sm gap-6">
        {/* Header: logo + title + subtitle */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center justify-center">
            <ImpLogo className="w-auto h-24" />
          </div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm text-imp-muted-foreground">{subtitle}</p>
        </div>

        {/* Form */}
        <SignInForm onSuccess={onSuccess} />

        {/* Separator + admin note */}
        <div className="relative text-sm text-center">
          <div className="absolute inset-0 border-t top-1/2 border-imp-border" />
          <span className="relative px-2 bg-imp-background text-imp-muted-foreground">
            Admin-managed accounts
          </span>
        </div>

        <p className="px-6 text-xs text-center text-imp-muted-foreground">
          {onNavigateToSignUp ? ' Or ' : ' Contact your admin if you need access.'}
          {onNavigateToSignUp && (
            <button
              type="button"
              onClick={onNavigateToSignUp}
              className="font-medium underline underline-offset-4 hover:text-imp-foreground"
            >
              Sign up
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Internal: Imperat logo
// ─────────────────────────────────────────────────────────────

function ImpLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 109 209"
      fill="none"
      stroke="currentColor"
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M31.7735 104.5L4.50073 18.7859L54.5007 33.0716L31.7735 104.5Z" />
      <path d="M54.5007 4.5L104.501 18.7857L54.5007 33.0714L4.50073 18.7857L54.5007 4.5Z" />
      <path d="M4.50073 190.214L54.5007 33.0716L104.501 18.7859L4.50073 190.214Z" />
      <path d="M54.5007 204.5L81.4238 104.5L104.501 18.7859L4.50073 190.214L54.5007 204.5Z" />
      <path d="M54.5007 204.5L81.4238 104.5L104.501 190.214L54.5007 204.5Z" />
    </svg>
  );
}
