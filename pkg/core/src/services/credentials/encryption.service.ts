/**
 * Encryption Service
 *
 * Handles encryption and decryption of sensitive credential data.
 * Uses AES-256-GCM for authenticated encryption with PBKDF2-SHA256 key
 * derivation, all routed through the WebCrypto API (`crypto.subtle`) so the
 * service runs unchanged on Cloudflare Workers, Deno, Bun, and Node 22+ —
 * NO `node:crypto` is required for the hot path.
 *
 * Wire format (`EncryptedData`) is unchanged across this WebCrypto port.
 * A new `version: 1` envelope field tags writes from this implementation;
 * envelopes lacking `version` are treated as legacy (pre-port) and decrypted
 * with the original PBKDF2 iteration count (100k). A separate `decryptLegacy()`
 * path covers the (hypothetical) scrypt-based KDF — it lazily loads
 * `node:crypto` and is a no-op on edge runtimes.
 */

// `webcrypto.CryptoKey` is a type-only re-export from @types/node and
// corresponds to the global `CryptoKey` exposed by every modern runtime
// (Node 22+, Cloudflare Workers, Deno, Bun). Importing it as a type avoids
// pulling in DOM lib while still getting the WebCrypto type surface.
import type { webcrypto } from 'node:crypto';
type CryptoKey = webcrypto.CryptoKey;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV is recommended for AES-GCM (Node accepted 16; we now use the spec-aligned 12)
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16; // bytes (128-bit GCM tag)

/** Modern PBKDF2 iteration count — chosen to match OWASP 2023 guidance. */
const PBKDF2_ITERATIONS_V1 = 600_000;
/** Original PBKDF2 iteration count — used to decrypt envelopes written by the
 *  pre-WebCrypto implementation (no `version` field). */
const PBKDF2_ITERATIONS_LEGACY = 100_000;
const PBKDF2_HASH = 'SHA-256';
const DERIVED_KEY_LENGTH_BITS = 256;

/** Wire-format version. Bumped to 1 when this WebCrypto port shipped. */
const ENVELOPE_VERSION = 1;

interface EncryptionConfig {
  /** Master encryption key (should be loaded from environment variable) */
  masterKey: string;
}

export interface EncryptedData {
  /** Encrypted data as base64 string */
  ciphertext: string;
  /** Initialization vector as base64 string */
  iv: string;
  /** Authentication tag as base64 string */
  authTag: string;
  /** Salt used for key derivation as base64 string */
  salt: string;
  /** Algorithm used */
  algorithm: string;
  /** Envelope version. Missing on legacy envelopes (pre-WebCrypto port). */
  version?: number;
}

// ─── base64 helpers (no Buffer required for the hot path) ────────────

function base64ToBytes(b64: string): Uint8Array {
  // atob is available in Node 16+ and on every edge runtime.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunk to avoid blowing the call stack on big buffers.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Copy `bytes` into a fresh ArrayBuffer view that satisfies WebCrypto's `BufferSource` type. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** True when running on a Node-like runtime (Node, Bun) — false on Workers/Deno-deploy. */
function isNodeRuntime(): boolean {
  // `process.versions.node` is the most reliable Node-or-Bun signal.
  // Workers expose neither.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process;
  return typeof proc !== 'undefined' && !!proc.versions?.node;
}

export class EncryptionService {
  /** Master key bytes — derived once at construction and reused for every PBKDF2 call. */
  private readonly masterKeyBytes: Uint8Array;
  /** Imported `raw` CryptoKey usable as PBKDF2 input. Cached after first access. */
  private masterKeyMaterial: Promise<CryptoKey> | null = null;

  constructor(config: EncryptionConfig) {
    if (!config.masterKey) {
      throw new Error('Master encryption key is required');
    }

    // Decode the base64-encoded master key into raw bytes.
    // If the key is not valid base64 (legacy plain-text key), fall back to UTF-8.
    let decoded: Uint8Array;
    try {
      decoded = base64ToBytes(config.masterKey);
    } catch {
      decoded = new Uint8Array();
    }
    const reEncoded = decoded.length > 0 ? bytesToBase64(decoded) : '';
    this.masterKeyBytes =
      decoded.length >= 32 && reEncoded === config.masterKey
        ? decoded
        : utf8Encode(config.masterKey);
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  private async getMasterKeyMaterial(): Promise<CryptoKey> {
    if (!this.masterKeyMaterial) {
      this.masterKeyMaterial = crypto.subtle.importKey(
        'raw',
        asBufferSource(this.masterKeyBytes),
        { name: 'PBKDF2' },
        /* extractable */ false,
        ['deriveKey'],
      );
    }
    return this.masterKeyMaterial;
  }

  private async deriveAesKey(salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const baseKey = await this.getMasterKeyMaterial();
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: asBufferSource(salt),
        iterations,
        hash: PBKDF2_HASH,
      },
      baseKey,
      { name: 'AES-GCM', length: DERIVED_KEY_LENGTH_BITS },
      /* extractable */ false,
      ['encrypt', 'decrypt'],
    );
  }

  // ─── Public encryption API ─────────────────────────────────────────

  /**
   * Encrypt data using AES-256-GCM.
   * Returns an envelope tagged with `version: 1` so future readers can pick the
   * right KDF parameters. New writes always use the modern PBKDF2 iteration count.
   *
   * The optional `_context` parameter satisfies the `EncryptionAdapter` contract
   * (`src/types/services.ts`). The default in-process service intentionally
   * ignores it — wire format is unchanged. Multi-tenant adapters use the
   * context (e.g. `organizationId`) to select a per-tenant DEK.
   */
  async encrypt(
    plaintext: string | object,
    _context?: import('../../types/services').EncryptionContext,
  ): Promise<EncryptedData> {
    try {
      const plaintextString = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);

      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

      const aesKey = await this.deriveAesKey(salt, PBKDF2_ITERATIONS_V1);

      // WebCrypto returns ciphertext || authTag concatenated; split them so the
      // wire envelope keeps storing them separately (Node's `getAuthTag()` shape).
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: asBufferSource(iv), tagLength: AUTH_TAG_LENGTH * 8 },
        aesKey,
        asBufferSource(utf8Encode(plaintextString)),
      );
      const encrypted = new Uint8Array(encryptedBuffer);
      const ciphertextBytes = encrypted.subarray(0, encrypted.length - AUTH_TAG_LENGTH);
      const authTagBytes = encrypted.subarray(encrypted.length - AUTH_TAG_LENGTH);

      return {
        ciphertext: bytesToBase64(ciphertextBytes),
        iv: bytesToBase64(iv),
        authTag: bytesToBase64(authTagBytes),
        salt: bytesToBase64(salt),
        algorithm: ALGORITHM,
        version: ENVELOPE_VERSION,
      };
    } catch (error) {
      throw new Error(
        `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Decrypt data that was encrypted with `encrypt()`.
   *
   * Detects envelope version: `version >= 1` uses the modern PBKDF2 iteration
   * count; missing `version` is treated as legacy (pre-WebCrypto port) and
   * decrypted with the original 100k iterations. Both paths run through
   * `crypto.subtle` so no `node:crypto` import is needed.
   *
   * For envelopes encrypted with the (hypothetical) scrypt KDF used by very
   * early builds, callers must use `decryptLegacy()` — which lazily loads
   * `node:crypto` and only works on Node-like runtimes.
   *
   * The optional `_context` parameter satisfies the `EncryptionAdapter` contract
   * (`src/types/services.ts`). The default in-process service ignores it —
   * wire format unchanged. Multi-tenant adapters use it (e.g.
   * `organizationId`) to select a per-tenant DEK.
   */
  async decrypt(
    encrypted: EncryptedData,
    _context?: import('../../types/services').EncryptionContext,
  ): Promise<string> {
    try {
      const { ciphertext, iv, authTag, salt, algorithm, version } = encrypted;

      if (algorithm !== ALGORITHM) {
        throw new Error(`Unsupported algorithm: ${algorithm}`);
      }

      const ivBytes = base64ToBytes(iv);
      const authTagBytes = base64ToBytes(authTag);
      const saltBytes = base64ToBytes(salt);
      const ciphertextBytes = base64ToBytes(ciphertext);

      // WebCrypto's AES-GCM expects ciphertext||authTag concatenated.
      const combined = concatBytes(ciphertextBytes, authTagBytes);

      const iterations =
        typeof version === 'number' && version >= 1
          ? PBKDF2_ITERATIONS_V1
          : PBKDF2_ITERATIONS_LEGACY;

      const aesKey = await this.deriveAesKey(saltBytes, iterations);

      const plaintextBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: asBufferSource(ivBytes), tagLength: AUTH_TAG_LENGTH * 8 },
        aesKey,
        asBufferSource(combined),
      );

      return utf8Decode(new Uint8Array(plaintextBuffer));
    } catch (error) {
      throw new Error(
        `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Decrypt a credential envelope encrypted by a hypothetical scrypt-based KDF.
   * Provided as a defensive shim for any pre-PBKDF2 data that may still exist.
   *
   * Only available on Node-like runtimes (Node, Bun) — throws on Workers/Deno
   * because `node:crypto.scryptSync` is not part of WebCrypto. The import is
   * deferred so simply having this method on the class does not pull
   * `node:crypto` into the edge bundle.
   *
   * Expected envelope shape (string-or-buffer params):
   *   - keyLength: 32 bytes (AES-256)
   *   - scrypt params: N=16384, r=8, p=1 (Node defaults)
   * Override via `options` if the original writer used different params.
   */
  async decryptLegacy(
    encrypted: EncryptedData,
    options: { N?: number; r?: number; p?: number; keyLength?: number } = {},
  ): Promise<string> {
    if (!isNodeRuntime()) {
      throw new Error(
        'decryptLegacy() requires a Node-like runtime (node:crypto.scryptSync). ' +
          'Edge runtimes cannot decrypt scrypt-KDF envelopes — re-encrypt them first.',
      );
    }

    try {
      const { ciphertext, iv, authTag, salt, algorithm } = encrypted;
      if (algorithm !== ALGORITHM) {
        throw new Error(`Unsupported algorithm: ${algorithm}`);
      }

      // Lazy-load node:crypto so this import is tree-shaken / never loaded on
      // Workers. The runtime guard above must remain in lock-step with this.
      const nodeCrypto = await import('node:crypto');

      const ivBuf = Buffer.from(iv, 'base64');
      const authTagBuf = Buffer.from(authTag, 'base64');
      const saltBuf = Buffer.from(salt, 'base64');

      const N = options.N ?? 16384;
      const r = options.r ?? 8;
      const p = options.p ?? 1;
      const keyLength = options.keyLength ?? 32;

      const key = nodeCrypto.scryptSync(this.masterKeyBytes, saltBuf, keyLength, { N, r, p });

      const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, ivBuf);
      decipher.setAuthTag(authTagBuf);

      let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
      plaintext += decipher.final('utf8');
      return plaintext;
    } catch (error) {
      throw new Error(
        `Legacy decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Encrypt an object and return as an encrypted string
   * Useful for storing in database
   */
  async encryptObject<T extends object>(obj: T): Promise<string> {
    const encrypted = await this.encrypt(obj);
    return JSON.stringify(encrypted);
  }

  /**
   * Decrypt a string that was encrypted with encryptObject()
   * Returns the original object
   */
  async decryptObject<T extends object>(encryptedString: string): Promise<T> {
    const encrypted = JSON.parse(encryptedString) as EncryptedData;
    const decrypted = await this.decrypt(encrypted);
    return JSON.parse(decrypted) as T;
  }

  /**
   * Hash a value using SHA-256
   * Useful for creating searchable hashes of sensitive data
   */
  async hash(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', asBufferSource(utf8Encode(value)));
    return bytesToHex(new Uint8Array(digest));
  }

  /**
   * Generate a cryptographically secure random token
   * Useful for API keys, tokens, etc.
   */
  generateToken(length: number = 32): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return bytesToHex(bytes);
  }

  /**
   * Validate encryption key strength
   * Returns true if the key meets minimum security requirements
   */
  static validateMasterKey(key: string): boolean {
    // Minimum 32 characters (256 bits)
    if (key.length < 32) {
      return false;
    }

    // Should contain mix of characters
    const hasUpperCase = /[A-Z]/.test(key);
    const hasLowerCase = /[a-z]/.test(key);
    const hasNumbers = /[0-9]/.test(key);
    const hasSpecial = /[^A-Za-z0-9]/.test(key);

    // Require at least 3 of the 4 character types
    const characterTypes = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecial].filter(
      Boolean,
    ).length;

    return characterTypes >= 3;
  }

  /**
   * Generate a new master key
   * Should be stored securely (e.g., in environment variable or secret manager)
   */
  static generateMasterKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return bytesToBase64(bytes);
  }
}

/**
 * Factory function to create an encryption service from a base64-encoded
 * master key. Caller is responsible for sourcing the key (e.g. from
 * `process.env.FLOWLIB_ENCRYPTION_KEY` in a Node host, from
 * `env.FLOWLIB_ENCRYPTION_KEY` in a Cloudflare Worker, etc.). Core does not
 * sniff `process.env` so it stays portable to edge runtimes.
 */
export function createEncryptionService(masterKey: string | undefined): EncryptionService {
  if (!masterKey) {
    throw new Error(
      'masterKey is required. Generate one with: npx flowlib-cli secret. ' +
        'Pass it explicitly to createEncryptionService(masterKey) — core no longer reads ' +
        'process.env.FLOWLIB_ENCRYPTION_KEY automatically (this lets it run on edge runtimes).',
    );
  }

  if (!EncryptionService.validateMasterKey(masterKey)) {
    // Warn about weak encryption key (in production, should throw error)
    throw new Error(
      'Encryption key does not meet security requirements. ' +
        'It should be at least 32 characters and contain a mix of character types.',
    );
  }

  return new EncryptionService({ masterKey });
}
