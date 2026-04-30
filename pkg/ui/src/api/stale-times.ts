/**
 * Cache tiers for React Query `staleTime` (and where useful, `gcTime`).
 *
 * The tier picked for a query reflects how stale the user can tolerate
 * the data being **without noticing or being misled**. Mutations should
 * always invalidate the relevant cache keys regardless of staleness, so
 * these durations only matter for passive navigation (returning to a
 * page you previously viewed).
 *
 * Tier guide:
 *
 *   LIVE      (10s)   — Data tied to an in-flight execution. The user
 *                       expects "near-real-time" but live updates flow
 *                       through SSE / websockets, so 10s is a fallback
 *                       not a polling cadence.
 *   SHORT     (1m)    — Things the user actively edits or watches change
 *                       within a session: flow detail, version list,
 *                       trigger list, dashboard counters.
 *   MEDIUM    (5m)    — Lists they scroll past more than they edit:
 *                       credentials list, action loaders, field option
 *                       dropdowns. Long enough to feel snappy on
 *                       sidebar navigation, short enough that creating
 *                       a credential elsewhere shows up reasonably soon.
 *   LONG      (30m)   — Per-user catalogues that essentially never change
 *                       within a working session: model lists keyed by
 *                       credential, OAuth provider details.
 *   STATIC    (24h)   — Worker-bundled catalogues. The action registry
 *                       and OAuth provider list can ONLY change when the
 *                       Worker code is redeployed — at which point the
 *                       browser reloads anyway.
 *
 * Keep these in seconds * milliseconds form so it reads naturally
 * (`MINUTE * 5`) and so eslint/oxlint sees the multiplication.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const staleTime = {
  /** No cache — refetch on every mount. Use for live-execution queries. */
  always: 0,
  /** 10 seconds — SSE-backed live data fallback. */
  live: 10 * SECOND,
  /** 1 minute — actively-edited entities. */
  short: 1 * MINUTE,
  /** 5 minutes — sidebar lists, dropdowns, action params. */
  medium: 5 * MINUTE,
  /** 30 minutes — per-credential catalogues that rarely shift mid-session. */
  long: 30 * MINUTE,
  /** 24 hours — Worker-bundled, only changes on deploy. */
  static: 24 * HOUR,
} as const;

export type StaleTimeTier = keyof typeof staleTime;
