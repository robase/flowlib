---
'@flowlib/webhooks': minor
---

# Webhooks: universal `Idempotency-Key` header support

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
