# @flowlib/webhooks

## 0.0.8

### Patch Changes

- [#16](https://github.com/robase/flowlib/pull/16) [`a139a03`](https://github.com/robase/flowlib/commit/a139a03a2bb456326ac02d6b444a0bdd882c39ef) Thanks [@robase](https://github.com/robase)! - feat: agents ([#16](https://github.com/robase/flowlib/issues/16))

- [#19](https://github.com/robase/flowlib/pull/19) [`ae77ef5`](https://github.com/robase/flowlib/commit/ae77ef52a2b8ea4f9f9d592ccc160ac4ff0ce654) Thanks [@robase](https://github.com/robase)! - feat: agents + remote sessions + mcp tools ([#19](https://github.com/robase/flowlib/issues/19))

- Updated dependencies [[`a139a03`](https://github.com/robase/flowlib/commit/a139a03a2bb456326ac02d6b444a0bdd882c39ef), [`ae77ef5`](https://github.com/robase/flowlib/commit/ae77ef52a2b8ea4f9f9d592ccc160ac4ff0ce654)]:
  - @flowlib/core@0.0.8
  - @flowlib/db@0.0.8
  - @flowlib/ui@0.0.8

## 0.0.7

### Patch Changes

- [#14](https://github.com/robase/flowlib/pull/14) [`d5a16b3`](https://github.com/robase/flowlib/commit/d5a16b33924cb7c7d1c5d12190930e312e4a7b35) Thanks [@robase](https://github.com/robase)! - # Webhooks: universal `Idempotency-Key` header support

  `WebhookSignatureService.getDeliveryId()` now falls back to the standard `Idempotency-Key` HTTP header (RFC draft / Stripe convention) when a provider-specific delivery-id header isn't set or doesn't apply. The dedup pipeline keys off this id, so external systems retrying a webhook delivery can guarantee idempotency by sending the same key each time.

  ## Behaviour

  | Provider config                                | Header sent                                       | Dedup id                 |
  | ---------------------------------------------- | ------------------------------------------------- | ------------------------ |
  | `provider: 'github'` (has `x-github-delivery`) | `x-github-delivery: abc123`                       | `abc123` (existing)      |
  | `provider: 'github'`                           | `x-github-delivery: abc123`, `Idempotency-Key: x` | `abc123` (provider wins) |
  | `provider: 'github'`                           | (no `x-github-delivery`), `Idempotency-Key: x`    | `x` (new fallback)       |
  | `provider: 'generic'` or `'none'`              | `Idempotency-Key: x`                              | `x` (new)                |
  | `provider: 'generic'` or `'none'`              | (none)                                            | `undefined` (no dedup)   |
  | Unknown provider                               | `Idempotency-Key: x`                              | `x` (new fallback)       |

  Provider-specific headers retain priority — anyone integrating with GitHub or Linear keeps using the well-known headers their providers send, so this change cannot regress dedup for those flows.

  ## Why

  External systems retrying webhook deliveries currently can't dedupe at all when:
  - The webhook trigger is configured with `provider: 'generic'` (most self-integration cases).
  - The provider config in `WEBHOOK_PROVIDER_SIGNATURES` doesn't carry a `deliveryIdHeader` (e.g., Stripe).

  A standard `Idempotency-Key` lets the caller — not the registered provider — drive dedup, matching how Stripe, Plaid, Square, and other modern APIs handle the same problem.

  ## Migration

  None. Existing GitHub / Slack / Linear integrations keep their existing dedup behaviour. Generic webhooks will start deduplicating any time the caller sends an `Idempotency-Key` header, which is a strict improvement (without the header you get the old "always accept" behaviour).

- Updated dependencies [[`d5a16b3`](https://github.com/robase/flowlib/commit/d5a16b33924cb7c7d1c5d12190930e312e4a7b35)]:
  - @flowlib/core@0.0.7
  - @flowlib/ui@0.0.7
  - @flowlib/db@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [[`8c079ae`](https://github.com/robase/flowlib/commit/8c079aeb68ef33409c96d6db762aed5715a39399)]:
  - @flowlib/core@0.0.6
  - @flowlib/ui@0.0.6
  - @flowlib/db@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [[`7d4db0c`](https://github.com/robase/flowlib/commit/7d4db0c537d77410bc76d968a1ecd7da672da5c8)]:
  - @flowlib/db@0.0.5
  - @flowlib/core@0.0.5
  - @flowlib/ui@0.0.5

## 0.0.4

### Patch Changes

- version control overhaul

- Updated dependencies []:
  - @flowlib/core@0.0.4
  - @flowlib/ui@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [[`4dee9d6`](https://github.com/robase/flowlib/commit/4dee9d67222426ee5ce16ab1c8a87f1b33144870)]:
  - @flowlib/core@0.0.3
  - @flowlib/ui@0.0.3

## 0.0.2

### Patch Changes

- [`32eff5d`](https://github.com/robase/flowlib/commit/32eff5d0d9ddf8f2d4e7045a5c5d0066c85d09fe) Thanks [@robase](https://github.com/robase)! - welcome flowlib!

- Updated dependencies [[`32eff5d`](https://github.com/robase/flowlib/commit/32eff5d0d9ddf8f2d4e7045a5c5d0066c85d09fe)]:
  - @flowlib/core@0.0.2
  - @flowlib/ui@0.0.2

## 0.0.12

### Patch Changes

- Pre release

- Updated dependencies []:
  - @flowlib/core@0.0.12
  - @flowlib/ui@0.0.12

## 0.0.11

### Patch Changes

- debug nextjs

- Updated dependencies []:
  - @flowlib/core@0.0.11
  - @flowlib/ui@0.0.11

## 0.0.10

### Patch Changes

- fix db tables

- Updated dependencies []:
  - @flowlib/core@0.0.10
  - @flowlib/ui@0.0.10

## 0.0.9

### Patch Changes

- audit packages

- Updated dependencies []:
  - @flowlib/core@0.0.9
  - @flowlib/ui@0.0.9

## 0.0.8

### Patch Changes

- fix frontend api

- Updated dependencies []:
  - @flowlib/core@0.0.8
  - @flowlib/ui@0.0.8

## 0.0.7

### Patch Changes

- fix dynamic imports

- Updated dependencies []:
  - @flowlib/core@0.0.7
  - @flowlib/ui@0.0.7

## 0.0.6

### Patch Changes

- secure-exec -> quickjs revert

- Updated dependencies []:
  - @flowlib/core@0.0.6
  - @flowlib/ui@0.0.6

## 0.0.5

### Patch Changes

-

- Updated dependencies []:
  - @flowlib/core@0.0.5
  - @flowlib/ui@0.0.5

## 0.0.4

### Patch Changes

- fix: nextjs imports

- Updated dependencies []:
  - @flowlib/core@0.0.4
  - @flowlib/ui@0.0.4

## 0.0.3

### Patch Changes

- fix core exports issue

- Updated dependencies []:
  - @flowlib/core@0.0.3
  - @flowlib/ui@0.0.3

## 0.0.2

### Patch Changes

- fix cli commands, replace quickjs wasm with secure-exec

- Updated dependencies []:
  - @flowlib/core@0.0.2
  - @flowlib/ui@0.0.2
