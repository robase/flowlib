/**
 * @flowlib/user-auth — Shared Types
 *
 * Serializable types shared between backend and frontend.
 * No runtime code, no React, no Node.js dependencies.
 */

// ─────────────────────────────────────────────────────────────
// Session / Identity (mirrors what GET /auth/me returns)
// ─────────────────────────────────────────────────────────────

export interface AuthSession {
  user: AuthUser;
  isAuthenticated: boolean;
}

export interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  image?: string;
  role?: string;
  twoFactorEnabled?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Auth Action Types (for sign-in / sign-up forms)
// ─────────────────────────────────────────────────────────────

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  name?: string;
}

/**
 * Input for creating a new user (admin-only action).
 */
export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: string;
}

/**
 * Input for updating a user's role (admin-only action).
 */
export interface UpdateUserRoleInput {
  role: string;
}

export interface AuthError {
  code: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────
// Two-Factor Authentication Types
// ─────────────────────────────────────────────────────────────

/**
 * Response from the sign-in endpoint when 2FA is required.
 * The frontend should show the 2FA verification form.
 */
export interface TwoFactorRedirect {
  twoFactorRedirect: true;
}

/**
 * Response from enabling 2FA — contains the TOTP URI and backup codes.
 */
export interface TwoFactorEnableResponse {
  totpURI: string;
  backupCodes: string[];
}

/**
 * Input for verifying a TOTP code during sign-in or 2FA setup.
 */
export interface TwoFactorVerifyInput {
  code: string;
  /** If true, remember this device for 30 days. */
  trustDevice?: boolean;
}

/**
 * Input for enabling 2FA — requires the user's current password.
 */
export interface TwoFactorEnableInput {
  password: string;
}

/**
 * Input for disabling 2FA — requires the user's current password.
 */
export interface TwoFactorDisableInput {
  password: string;
}
