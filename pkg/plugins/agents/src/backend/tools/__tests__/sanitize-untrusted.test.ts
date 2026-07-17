/**
 * sanitiseUntrustedText — strips invisible/deceptive Unicode (hidden
 * prompt-injection channels) while preserving legitimate text + whitespace.
 *
 * Hidden chars are built with String.fromCodePoint so this test file stays
 * pure-ASCII (no actual invisible chars in source).
 */
import { describe, it, expect } from 'vitest';
import { sanitiseUntrustedText } from '../sanitize-untrusted';

const cp = (n: number) => String.fromCodePoint(n);

describe('sanitiseUntrustedText', () => {
  it('strips zero-width, bidi, BOM, and word-joiner chars', () => {
    const dirty = 'hel' + cp(0x200b) + 'lo' + cp(0x200d) + cp(0xfeff) + cp(0x2060) + 'world';
    const { text, removed } = sanitiseUntrustedText(dirty);
    expect(text).toBe('helloworld');
    expect(removed).toBe(4);
  });

  it('strips bidi overrides/isolates (Trojan-Source)', () => {
    const dirty = 'safe' + cp(0x202e) + 'evil' + cp(0x2066) + cp(0x2069);
    const { text, removed } = sanitiseUntrustedText(dirty);
    expect(text).toBe('safeevil');
    expect(removed).toBe(3);
  });

  it('strips the Unicode Tags block (ASCII smuggling, astral)', () => {
    // U+E0041 etc. — an invisible "tag" message hidden after visible text.
    const hidden = cp(0xe0048) + cp(0xe0049); // tag-H tag-I
    const { text, removed } = sanitiseUntrustedText('visible' + hidden);
    expect(text).toBe('visible');
    expect(removed).toBe(2); // counted as 2 code points, not 4 surrogate halves
  });

  it('strips C0/C1 control chars but keeps tab, newline, carriage return', () => {
    const dirty = 'a' + cp(0x07) + 'b\tc\nd\re' + cp(0x9f) + 'f';
    const { text, removed } = sanitiseUntrustedText(dirty);
    expect(text).toBe('ab\tc\nd\ref');
    expect(removed).toBe(2);
  });

  it('leaves legitimate text + unicode untouched and reports zero removed', () => {
    const clean = 'café — naïve 🚀 \tindented\nnext';
    const { text, removed } = sanitiseUntrustedText(clean);
    expect(text).toBe(clean.normalize('NFC'));
    expect(removed).toBe(0);
  });
});
