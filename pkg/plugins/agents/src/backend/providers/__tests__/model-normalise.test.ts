import { describe, expect, it } from 'vitest';
import { normaliseModelForCredential } from '../model-normalise';

describe('normaliseModelForCredential', () => {
  it('prefixes a vendor-qualified model AND dots hyphenated versions for openrouter', () => {
    const r = normaliseModelForCredential({
      model: 'anthropic/claude-sonnet-4-5',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-sonnet-4.5');
    expect(r.rewritten).toBe(true);
  });

  it('prefixes a bare model with the openrouter router (no version digits, no dot rewrite)', () => {
    const r = normaliseModelForCredential({
      model: 'gpt-4o',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/gpt-4o');
    expect(r.rewritten).toBe(true);
  });

  it('does not re-prefix when already openrouter-prefixed, but DOES still dot legacy hyphens', () => {
    const r = normaliseModelForCredential({
      model: 'openrouter/anthropic/claude-sonnet-4-5',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-sonnet-4.5');
    expect(r.rewritten).toBe(true);
  });

  it('passes through openrouter-prefixed model when already dotted', () => {
    const r = normaliseModelForCredential({
      model: 'openrouter/anthropic/claude-sonnet-4.5',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-sonnet-4.5');
    expect(r.rewritten).toBe(false);
  });

  it('prefixes for cloudflare-ai-gateway (and dots versions)', () => {
    const r = normaliseModelForCredential({
      model: 'anthropic/claude-haiku-4-5',
      credentialVendor: 'cloudflare-ai-gateway',
    });
    expect(r.model).toBe('cloudflare-ai-gateway/anthropic/claude-haiku-4.5');
    expect(r.rewritten).toBe(true);
  });

  it('leaves direct vendor credentials alone (no prefix, no dot rewrite)', () => {
    // The native Anthropic API uses hyphens (`claude-sonnet-4-5`); we
    // only rewrite when going through a router that uses dots.
    const r = normaliseModelForCredential({
      model: 'anthropic/claude-sonnet-4-5',
      credentialVendor: 'anthropic',
    });
    expect(r.model).toBe('anthropic/claude-sonnet-4-5');
    expect(r.rewritten).toBe(false);
  });

  it('does not coerce when the user explicitly addressed a different direct vendor', () => {
    const r = normaliseModelForCredential({
      model: 'openrouter/anthropic/claude-sonnet-4-5',
      credentialVendor: 'anthropic',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-sonnet-4-5');
    expect(r.rewritten).toBe(false);
  });

  it('is a no-op for `custom` vendor', () => {
    const r = normaliseModelForCredential({
      model: 'anthropic/claude-sonnet-4-5',
      credentialVendor: 'custom',
    });
    expect(r.model).toBe('anthropic/claude-sonnet-4-5');
    expect(r.rewritten).toBe(false);
  });

  it('handles mid-name version numbers (claude-3-5-sonnet → claude-3.5-sonnet)', () => {
    const r = normaliseModelForCredential({
      model: 'anthropic/claude-3-5-sonnet',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-3.5-sonnet');
    expect(r.rewritten).toBe(true);
  });

  it('preserves single-digit version slugs like `claude-3-haiku`', () => {
    // `3-haiku` is not a digit-digit pair, so the regex doesn't fire.
    const r = normaliseModelForCredential({
      model: 'anthropic/claude-3-haiku',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-3-haiku');
    expect(r.rewritten).toBe(true);
  });

  it('trims whitespace', () => {
    const r = normaliseModelForCredential({
      model: '  anthropic/claude-sonnet-4-5  ',
      credentialVendor: 'openrouter',
    });
    expect(r.model).toBe('openrouter/anthropic/claude-sonnet-4.5');
    expect(r.rewritten).toBe(true);
  });
});
