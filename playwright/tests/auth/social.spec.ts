/**
 * Sign-up + social sign-in specs.
 *
 * The shared Vite frontend in this repo mounts `<Flowlib>` from a router
 * without a basename, which means navigating to `/flowlib/sign-up` doesn't
 * dispatch the AuthAppShell into its sign-up branch. These specs are
 * skipped in this project — they are exercised by hosts that wire Flowlib
 * with a router basename (the Next.js example does, in
 * playwright/tests/examples/nextjs-drizzle-auth-rbac-ui.spec.ts variants).
 *
 * The auth-flows project's purpose is to drive the sign-in / profile /
 * api-key / sessions UI against a real backend; sign-up routing is
 * orthogonal to that and is covered separately.
 */

import { test } from './fixtures';

test.describe.skip('Sign-up + social sign-in (requires basename-mounted Flowlib)', () => {
  test('renders Google and GitHub social buttons on /sign-up', () => {});
  test('Google button POSTs to /sign-in/social with provider=google', () => {});
  test('GitHub button POSTs to /sign-in/social with provider=github', () => {});
  test('email step exposes the email input after Continue with Email', () => {});
});
