/**
 * `normaliseModelForCredential(model, credentialVendor)` — coerce a
 * model id to match the credential's vendor when one is a multi-tier
 * router (openrouter, cloudflare-ai-gateway).
 *
 * # Why this exists
 *
 * Users routinely create a session with a model like
 * `"anthropic/claude-sonnet-4-5"` even when their picked credential is
 * an OpenRouter key. opencode then tries to call `api.anthropic.com`
 * directly, the outbound handler can't find an `anthropic` binding for
 * the session (the user only has `openrouter`), and the call fails
 * with a 401 — silently from the user's perspective.
 *
 * The fix is to rewrite `"anthropic/claude-sonnet-4-5"` to
 * `"openrouter/anthropic/claude-sonnet-4-5"` when the credential is
 * `openrouter`, so opencode dispatches via openrouter's provider config
 * and our `outboundByHost['openrouter.ai']` handler picks up the
 * request with the openrouter key bound for this session.
 *
 * # Behaviour matrix
 *
 *   credential vendor     model in              model out
 *   ──────────────────    ─────────────────    ─────────────────
 *   openrouter            anthropic/X          openrouter/anthropic/X
 *   openrouter            openrouter/X         openrouter/X (no-op)
 *   openrouter            X (no slash)         openrouter/X
 *   cloudflare-ai-gateway anthropic/X          cloudflare-ai-gateway/anthropic/X
 *   anthropic             anthropic/X          anthropic/X (no-op)
 *   anthropic             openrouter/X         openrouter/X (no-op — direct vendor doesn't override)
 *   custom                X                    X (no-op)
 *
 * Direct vendors (anthropic / openai / google) deliberately don't coerce —
 * the user may legitimately want to call openrouter from a session that
 * has direct anthropic creds bound. Coercion only fires for multi-tier
 * *routers* where the router prefix is genuinely required.
 */

/**
 * Vendors that act as multi-tier routers — they expect the next path
 * segment of the model id to itself be a vendor (`openrouter/anthropic/...`).
 */
const ROUTER_VENDORS = new Set(['openrouter', 'cloudflare-ai-gateway']);

export interface NormaliseModelInput {
  model: string;
  /**
   * Vendor slug as returned by `inferOpencodeProvider`. May be
   * `'custom'`, in which case we leave the model alone.
   */
  credentialVendor: string;
}

export interface NormaliseModelResult {
  model: string;
  /** True when the input was rewritten. */
  rewritten: boolean;
  reason?: string;
}

/**
 * Convert hyphenated version numbers like `claude-sonnet-4-5` → `claude-sonnet-4.5`.
 *
 * The Anthropic native API publishes model ids with hyphens (`claude-sonnet-4-5`)
 * but **OpenRouter republishes them with a dot** (`anthropic/claude-sonnet-4.5`).
 * opencode looks the model id up in its provider's published catalogue;
 * sending a hyphenated id makes the lookup fail and opencode silently
 * accepts the prompt, returning HTTP 200 with `Content-Length: 0` and
 * never making the upstream LLM call. The chat appears to hang.
 *
 * This regex anchors on a digit-hyphen-digit pair so we only rewrite
 * version-style hyphens, not the rest of the slug:
 *
 *   claude-sonnet-4-5    → claude-sonnet-4.5
 *   claude-3-5-sonnet    → claude-3.5-sonnet
 *   claude-3-haiku       → claude-3-haiku  (no following digit, no change)
 *   gemini-2.0-flash-exp → gemini-2.0-flash-exp (already dotted, no change)
 */
function dottifyVersionNumbers(model: string): string {
  return model.replace(/(\d)-(\d)/g, '$1.$2');
}

export function normaliseModelForCredential(input: NormaliseModelInput): NormaliseModelResult {
  const trimmed = input.model.trim();
  if (!trimmed) {
    return { model: trimmed, rewritten: false };
  }
  if (!ROUTER_VENDORS.has(input.credentialVendor)) {
    return { model: trimmed, rewritten: false };
  }
  // First convert any legacy hyphenated version numbers to the dotted
  // form opencode/OpenRouter expects. Catches cases where the UI's model
  // catalog (or stored sessions) carries `claude-sonnet-4-5` instead of
  // `claude-sonnet-4.5`.
  const dotted = dottifyVersionNumbers(trimmed);
  const dottedRewritten = dotted !== trimmed;

  if (dotted.startsWith(`${input.credentialVendor}/`)) {
    return {
      model: dotted,
      rewritten: dottedRewritten,
      reason: dottedRewritten
        ? `Converted hyphenated version numbers to dots ("${trimmed}" → "${dotted}") to match opencode/OpenRouter's model catalogue.`
        : undefined,
    };
  }

  const out = `${input.credentialVendor}/${dotted}`;
  const reasons: string[] = [];
  if (dottedRewritten) {
    reasons.push(
      `converted hyphenated version numbers ("${trimmed}" → "${dotted}") to match opencode/OpenRouter's model catalogue`,
    );
  }
  reasons.push(
    `Credential vendor "${input.credentialVendor}" is a multi-tier router; prefixed model "${dotted}" so opencode routes via the router rather than attempting a direct provider call.`,
  );
  return {
    model: out,
    rewritten: true,
    reason: reasons.join(' Then '),
  };
}
