/**
 * Shared query/mutation options factories for Better Auth client methods.
 *
 * Borrowed from better-auth-ui's `auth-query-options` / `auth-mutation-options`
 * — wires `throw: true` (so queries/mutations reject on failure) and an
 * AbortSignal into `fetchOptions`, and stamps stable cache keys.
 */

import {
  type MutationKey,
  type QueryKey,
  mutationOptions,
  queryOptions,
} from '@tanstack/react-query';
import type { BetterFetchError, BetterFetchOption } from 'better-auth/client';

export type AuthQueryFn<TData = unknown> = (params: {
  query?: Record<string, unknown>;
  fetchOptions?: BetterFetchOption;
}) => Promise<{ data: TData }>;

type AuthQueryFnData<TFn> = TFn extends AuthQueryFn<infer TData> ? TData : never;

export function authQueryOptions<TFn extends AuthQueryFn, const TQueryKey extends QueryKey>(
  authFn: TFn,
  queryKey: TQueryKey,
  params?: Parameters<TFn>[0],
) {
  return queryOptions<AuthQueryFnData<TFn>, BetterFetchError>({
    queryKey: [...queryKey, params?.query ?? null] as const,
    queryFn: ({ signal }) =>
      authFn({
        ...params,
        fetchOptions: { ...params?.fetchOptions, signal, throw: true },
      }) as Promise<AuthQueryFnData<TFn>>,
  });
}

export type AuthMutationFn<TData = unknown, TVariables = unknown> = (
  params: TVariables & { fetchOptions?: BetterFetchOption },
) => Promise<{ data: TData }>;

type AuthMutationFnData<TFn> = TFn extends AuthMutationFn<infer TData> ? TData : never;

// eslint-disable-next-line typescript/no-explicit-any -- matches upstream loose constraint
type AuthMutationFnVariables<TFn extends (...args: any) => any> =
  undefined extends Parameters<TFn>[0]
    ? void | NonNullable<Parameters<TFn>[0]>
    : Parameters<TFn>[0];

export function authMutationOptions<
  // eslint-disable-next-line typescript/no-explicit-any -- required-body endpoints fall through this
  TFn extends (...args: any) => any,
  const TMutationKey extends MutationKey,
  TData = AuthMutationFnData<TFn>,
>(authFn: TFn, mutationKey: TMutationKey) {
  return mutationOptions<TData, BetterFetchError, AuthMutationFnVariables<TFn>>({
    mutationKey,
    mutationFn: (variables) => {
      const v = variables as { fetchOptions?: BetterFetchOption } | undefined;
      return authFn({
        ...v,
        fetchOptions: { ...v?.fetchOptions, throw: true },
      } as Parameters<TFn>[0]) as Promise<TData>;
    },
  });
}
