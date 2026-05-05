/**
 * Webhook Signature Verification Service
 *
 * Validates HMAC signatures from webhook providers (GitHub, Slack, Stripe, Linear, etc.).
 * Moved from @flowlib/core to the webhooks plugin.
 *
 * Implementation note: ported from `node:crypto.createHmac` to WebCrypto so this
 * runs unchanged on Cloudflare Workers, Deno, and Bun. WebCrypto's
 * `crypto.subtle.verify('HMAC', ...)` is constant-time by spec, replacing the
 * Node-only `timingSafeEqual` we previously used.
 */

// ─── Provider Definitions ───────────────────────────────────────────

export interface WebhookProviderSignatureConfig {
  signatureHeader: string;
  algorithm: 'sha256' | 'sha1';
  signaturePrefix: string;
  deliveryIdHeader?: string;
  eventTypeHeader?: string;
}

export const WEBHOOK_PROVIDER_SIGNATURES: Record<string, WebhookProviderSignatureConfig> = {
  github: {
    signatureHeader: 'x-hub-signature-256',
    algorithm: 'sha256',
    signaturePrefix: 'sha256=',
    deliveryIdHeader: 'x-github-delivery',
    eventTypeHeader: 'x-github-event',
  },
  slack: {
    signatureHeader: 'x-slack-signature',
    algorithm: 'sha256',
    signaturePrefix: 'v0=',
    deliveryIdHeader: 'x-slack-request-timestamp',
    eventTypeHeader: undefined,
  },
  stripe: {
    signatureHeader: 'stripe-signature',
    algorithm: 'sha256',
    signaturePrefix: 'v1=',
    deliveryIdHeader: undefined,
    eventTypeHeader: 'stripe-event-type',
  },
  linear: {
    signatureHeader: 'linear-signature',
    algorithm: 'sha256',
    signaturePrefix: '',
    deliveryIdHeader: 'linear-delivery',
    eventTypeHeader: 'linear-event',
  },
};

// ─── WebCrypto helpers ──────────────────────────────────────────────

const encoder = new TextEncoder();

function bodyToBytes(rawBody: string | Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (typeof rawBody === 'string') {
    return encoder.encode(rawBody);
  }
  if (rawBody instanceof Uint8Array) {
    return rawBody;
  }
  return new Uint8Array(rawBody as ArrayBuffer);
}

/** Copy `bytes` into a fresh ArrayBuffer view that satisfies WebCrypto's `BufferSource` type. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      // Sentinel — caller treats a single 0xFF byte as "invalid hex" so verify
      // returns false rather than throwing.
      return new Uint8Array([0xff]);
    }
    bytes[i] = byte;
  }
  return bytes;
}

const HASH_ALG: Record<'sha256' | 'sha1', string> = {
  sha256: 'SHA-256',
  sha1: 'SHA-1',
};

async function importHmacKey(secret: string, algorithm: 'sha256' | 'sha1'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(encoder.encode(secret)),
    { name: 'HMAC', hash: HASH_ALG[algorithm] },
    /* extractable */ false,
    ['sign', 'verify'],
  );
}

/**
 * Constant-time compare of an expected hex digest against a received hex digest.
 * Routed through `crypto.subtle.verify` so the comparison is guaranteed
 * constant-time by the underlying implementation. Returns false on any malformed
 * input rather than throwing.
 */
async function verifyHexHmac(
  secret: string,
  data: Uint8Array,
  expectedHex: string,
  algorithm: 'sha256' | 'sha1',
): Promise<boolean> {
  const expectedBytes = hexToBytes(expectedHex);
  if (expectedBytes.length === 1 && expectedBytes[0] === 0xff && expectedHex.length !== 2) {
    return false;
  }
  const key = await importHmacKey(secret, algorithm);
  return crypto.subtle.verify('HMAC', key, asBufferSource(expectedBytes), asBufferSource(data));
}

// ─── Service ────────────────────────────────────────────────────────

type LoggerLike = {
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
};

export class WebhookSignatureService {
  constructor(private readonly logger: LoggerLike) {}

  async verify(
    provider: string,
    secret: string,
    rawBody: string | Uint8Array | ArrayBuffer | Buffer,
    headers: Record<string, string>,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!provider || provider === 'none' || provider === 'generic') {
      return { valid: true };
    }

    const config = WEBHOOK_PROVIDER_SIGNATURES[provider];
    if (!config) {
      this.logger.warn('Unknown webhook provider for signature verification, skipping', {
        provider,
      });
      return { valid: true };
    }

    const headerValue = headers[config.signatureHeader];
    if (!headerValue) {
      return {
        valid: false,
        error: `Missing signature header: ${config.signatureHeader}`,
      };
    }

    try {
      if (provider === 'slack') {
        return await this.verifySlack(secret, rawBody, headers);
      }
      if (provider === 'stripe') {
        return await this.verifyStripe(secret, rawBody, headerValue);
      }
      return await this.verifyHmac(config, secret, rawBody, headerValue);
    } catch (error) {
      this.logger.error('Webhook signature verification error', { provider, error });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Resolve a delivery id used for dedup keying. Provider-specific headers
   * (e.g., `x-github-delivery`) are preferred when present. The standard
   * `Idempotency-Key` header (RFC draft / Stripe convention) is the
   * universal fallback so callers using `provider: 'generic'` or
   * `'none'` — or providers without a delivery-id header in their
   * registered config — can still opt into dedup by setting a stable
   * key per logical retry attempt.
   */
  getDeliveryId(provider: string, headers: Record<string, string>): string | undefined {
    if (provider && provider !== 'none' && provider !== 'generic') {
      const config = WEBHOOK_PROVIDER_SIGNATURES[provider];
      const providerId = config?.deliveryIdHeader ? headers[config.deliveryIdHeader] : undefined;
      if (providerId) {
        return providerId;
      }
    }
    return headers['idempotency-key'] || undefined;
  }

  getEventType(provider: string, headers: Record<string, string>): string | undefined {
    if (!provider || provider === 'none' || provider === 'generic') {
      return undefined;
    }
    const config = WEBHOOK_PROVIDER_SIGNATURES[provider];
    if (!config?.eventTypeHeader) {
      return undefined;
    }
    return headers[config.eventTypeHeader] || undefined;
  }

  /**
   * Verify a custom HMAC signature where the user specifies the header name and secret.
   * Supports hex-encoded SHA-256 signatures, with or without a `sha256=` prefix.
   */
  async verifyCustomHmac(
    secret: string,
    headerName: string,
    rawBody: string | Uint8Array | ArrayBuffer | Buffer,
    headers: Record<string, string>,
  ): Promise<{ valid: boolean; error?: string }> {
    const normalizedHeader = headerName.toLowerCase();
    const headerValue = headers[normalizedHeader];
    if (!headerValue) {
      return { valid: false, error: `Missing signature header: ${headerName}` };
    }

    try {
      // Support optional sha256= prefix
      const signature = headerValue.startsWith('sha256=') ? headerValue.slice(7) : headerValue;

      const ok = await verifyHexHmac(secret, bodyToBytes(rawBody), signature, 'sha256');
      return ok ? { valid: true } : { valid: false, error: 'HMAC signature mismatch' };
    } catch (error) {
      this.logger.error('Custom HMAC verification error', { headerName, error });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  private async verifyHmac(
    config: WebhookProviderSignatureConfig,
    secret: string,
    rawBody: string | Uint8Array | ArrayBuffer | Buffer,
    headerValue: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const prefix = config.signaturePrefix;
    if (prefix && !headerValue.startsWith(prefix)) {
      return { valid: false, error: 'Signature prefix mismatch' };
    }
    const receivedHex = prefix ? headerValue.slice(prefix.length) : headerValue;

    const ok = await verifyHexHmac(secret, bodyToBytes(rawBody), receivedHex, config.algorithm);
    return ok ? { valid: true } : { valid: false, error: 'Signature mismatch' };
  }

  private async verifySlack(
    secret: string,
    rawBody: string | Uint8Array | ArrayBuffer | Buffer,
    headers: Record<string, string>,
  ): Promise<{ valid: boolean; error?: string }> {
    const timestamp = headers['x-slack-request-timestamp'];
    if (!timestamp) {
      return { valid: false, error: 'Missing x-slack-request-timestamp header' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return { valid: false, error: 'Request timestamp too old (possible replay)' };
    }

    const bodyBytes = bodyToBytes(rawBody);
    const bodyStr = new TextDecoder('utf-8').decode(bodyBytes);
    const sigBasestring = `v0:${timestamp}:${bodyStr}`;

    const signature = headers['x-slack-signature'] || '';
    if (!signature.startsWith('v0=')) {
      return { valid: false, error: 'Slack signature missing v0= prefix' };
    }
    const receivedHex = signature.slice(3);

    const ok = await verifyHexHmac(secret, encoder.encode(sigBasestring), receivedHex, 'sha256');
    return ok ? { valid: true } : { valid: false, error: 'Slack signature mismatch' };
  }

  private async verifyStripe(
    secret: string,
    rawBody: string | Uint8Array | ArrayBuffer | Buffer,
    headerValue: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const parts = headerValue.split(',');
    const tsEntry = parts.find((p) => p.startsWith('t='));
    const sigEntries = parts.filter((p) => p.startsWith('v1='));

    if (!tsEntry || sigEntries.length === 0) {
      return { valid: false, error: 'Malformed stripe-signature header' };
    }

    const timestamp = tsEntry.slice(2);
    const bodyBytes = bodyToBytes(rawBody);
    const bodyStr = new TextDecoder('utf-8').decode(bodyBytes);
    const signedPayload = `${timestamp}.${bodyStr}`;
    const payloadBytes = encoder.encode(signedPayload);

    // Stripe rotates signing secrets — accept the request if ANY of the listed
    // v1 signatures verifies.
    for (const entry of sigEntries) {
      const sig = entry.slice(3);
      // eslint-disable-next-line no-await-in-loop -- sequential by intent: we want to short-circuit on the first match
      const ok = await verifyHexHmac(secret, payloadBytes, sig, 'sha256');
      if (ok) {
        return { valid: true };
      }
    }

    return { valid: false, error: 'Stripe signature mismatch' };
  }
}
