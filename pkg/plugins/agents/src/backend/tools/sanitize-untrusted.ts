/**
 * Sanitise untrusted text before it enters the model's context.
 *
 * Every tool that returns external content — `web.fetch` (web pages),
 * `read_file`/`grep` (repo files), `run_shell` (command output), MCP tool
 * results — is an **indirect prompt-injection** vector: an attacker can
 * plant instructions in that content. Natural-language injection ("ignore
 * previous instructions…") can't be reliably detected, so the real defence
 * is least-privilege (egress allow-list, permission-gated tools, secret
 * isolation — see docs/coding-agent-parity-plan.md, Part E).
 *
 * This function handles the one part that IS fully solvable: **invisible /
 * deceptive Unicode** used to smuggle hidden instructions. These code-point
 * ranges are virtually never legitimate in prose or source, so stripping
 * them is safe and removes the "hidden unicode" channel entirely.
 *
 * The result is NFC-normalised. Returns the cleaned text plus a count of
 * removed code points so callers can surface "N hidden characters stripped".
 *
 * Implemented over numeric code-point ranges (not a regex literal) so this
 * source file itself contains no invisible/control characters.
 */

/**
 * Dangerous code-point ranges (inclusive). Tab (0x09), LF (0x0A), and
 * CR (0x0D) are deliberately preserved.
 */
const DANGEROUS_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08], // C0 controls before tab
  [0x0b, 0x0c], // VT, FF (skip LF 0x0A)
  [0x0e, 0x1f], // rest of C0 (skip CR 0x0D)
  [0x7f, 0x9f], // DEL + C1 controls
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings/overrides (Trojan-Source)
  [0x2060, 0x2064], // word-joiner + invisible math operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xe0000, 0xe007f], // Unicode Tags block (ASCII smuggling)
];

function isDangerous(cp: number): boolean {
  for (const [lo, hi] of DANGEROUS_RANGES) {
    if (cp >= lo && cp <= hi) {
      return true;
    }
  }
  return false;
}

export interface SanitiseResult {
  text: string;
  /** Number of code points removed. >0 means the source carried hidden chars. */
  removed: number;
}

export function sanitiseUntrustedText(input: string): SanitiseResult {
  let removed = 0;
  let out = '';
  // `for…of` iterates by code point, so astral chars (e.g. the Tags block)
  // are handled as single units, not surrogate halves.
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isDangerous(cp)) {
      removed += 1;
      continue;
    }
    out += ch;
  }
  try {
    out = out.normalize('NFC');
  } catch {
    // Extremely malformed input — leave as-is rather than throw.
  }
  return { text: out, removed };
}
