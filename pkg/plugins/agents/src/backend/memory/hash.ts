/**
 * Content hash for exact-duplicate detection.
 *
 * Mem0 uses MD5 to skip re-embedding / re-LLM'ing identical text. We
 * don't need a cryptographic hash (this isn't security) and MD5 isn't in
 * WebCrypto, so we use FNV-1a — fast, synchronous, dependency-free, and
 * available identically on Node and Cloudflare Workers.
 */

/** 32-bit FNV-1a hash of `text`, as zero-padded hex. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit space.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
