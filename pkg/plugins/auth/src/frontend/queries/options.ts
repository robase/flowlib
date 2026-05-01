/**
 * Query option factories for Better Auth endpoints.
 *
 * Each factory returns stable `queryOptions` keyed under
 * `["auth", ...]` so callers can seed/invalidate by key.
 */

import type { AuthClient } from '../lib/auth-client';
import { authQueryOptions } from '../lib/auth-options';

export function sessionOptions(
  authClient: AuthClient,
  params?: Parameters<AuthClient['getSession']>[0],
) {
  return authQueryOptions(authClient.getSession, ['auth', 'getSession'], params);
}

export function listSessionsOptions(
  authClient: AuthClient,
  userId?: string,
  params?: Parameters<AuthClient['listSessions']>[0],
) {
  return authQueryOptions(
    authClient.listSessions,
    ['auth', 'user', userId, 'listSessions'],
    params,
  );
}

export function listAccountsOptions(
  authClient: AuthClient,
  userId?: string,
  params?: Parameters<AuthClient['listAccounts']>[0],
) {
  return authQueryOptions(
    authClient.listAccounts,
    ['auth', 'user', userId, 'listAccounts'],
    params,
  );
}
