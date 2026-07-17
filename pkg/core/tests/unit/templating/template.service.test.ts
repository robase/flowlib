/**
 * Unit tests: TemplateService.isTemplate / containsTemplateBlock.
 *
 * `isTemplate` runs for every param of every node on the flow-execution hot
 * path, against attacker-controlled strings (flow inputs). It must be:
 *
 *   1. Exactly equivalent to the historical `/\{\{[^}]*\}\}/` regex — the
 *      predicate decides whether a param is rendered or passed through as a
 *      literal, so any drift silently changes every flow's behaviour.
 *   2. Linear in the input length — a quadratic scan lets a single string of
 *      `{` characters block the event loop for seconds.
 */
import { describe, it, expect } from 'vitest';
import { TemplateService } from '../../../src/services/templating/template.service';
import { JsExpressionService } from '../../../src/services/templating/js-expression.service';

/**
 * The reference implementation this predicate must match, kept verbatim as
 * the historical spec. Not used in production — only as the test oracle.
 */
const REFERENCE_PATTERN = /\{\{[^}]*\}\}/;
const reference = (value: string): boolean => REFERENCE_PATTERN.test(value);

/** `isTemplate` is pure — the sandbox is never invoked, so a bare instance is fine. */
const templateService = new TemplateService(new JsExpressionService());
const isTemplate = (value: unknown): boolean => templateService.isTemplate(value);

describe('TemplateService.isTemplate', () => {
  describe('non-strings', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['number', 42],
      ['object', { a: '{{ x }}' }],
      ['array', ['{{ x }}']],
    ])('returns false for %s', (_label, value) => {
      expect(isTemplate(value)).toBe(false);
    });
  });

  describe('recognised templates', () => {
    it.each([
      '{{ user.name }}',
      '{{a}}',
      '{{}}',
      '{{ }}',
      'hello {{ a }} and {{ b }}',
      'trailing text {{ a }}',
      '{{ items.filter(i => i.active).length }}',
      '{{{}}}',
      '{{ a }}}',
    ])('detects %j', (value) => {
      expect(isTemplate(value)).toBe(true);
    });
  });

  describe('non-templates', () => {
    it.each([
      '',
      'no template here',
      '{ { a } }',
      '{{',
      '}}',
      '}}{{',
      '{{ a',
      '{{{',
      // A lone `}` closes the block before `}}` is reached — the historical
      // regex `[^}]*` cannot cross it. Preserved deliberately.
      '{{ a } b }}',
      '{{ obj.fn({x: 1}) }}',
    ])('rejects %j', (value) => {
      expect(isTemplate(value)).toBe(false);
    });
  });

  describe('equivalence with the historical regex', () => {
    it('matches the reference over every string of length <= 6 (alphabet: { } a space)', () => {
      const alphabet = ['{', '}', 'a', ' '];
      const mismatches: string[] = [];
      let tested = 0;

      const walk = (s: string, depth: number): void => {
        tested += 1;
        if (isTemplate(s) !== reference(s)) {
          mismatches.push(s);
        }
        if (depth === 0) return;
        for (const ch of alphabet) walk(s + ch, depth - 1);
      };
      walk('', 6);

      expect(tested).toBe(5461); // sum(4^k) for k=0..6 — guards against a no-op walk
      expect(mismatches).toEqual([]);
    });

    it('matches the reference over random strings', () => {
      const alphabet = ['{', '}', 'a', ' ', '\n', '$', '.'];
      const mismatches: string[] = [];
      let positives = 0;

      for (let i = 0; i < 20_000; i += 1) {
        const len = 1 + Math.floor(Math.random() * 40);
        let s = '';
        for (let j = 0; j < len; j += 1) {
          s += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        if (reference(s)) positives += 1;
        if (isTemplate(s) !== reference(s)) mismatches.push(s);
      }

      expect(mismatches).toEqual([]);
      // Guard against a degenerate generator that only produces negatives.
      expect(positives).toBeGreaterThan(0);
    });
  });

  describe('runs in linear time (ReDoS regression)', () => {
    // Worst case: many `{{` each closed by a *lone* `}`, so the scan never
    // early-exits and every iteration does real work.
    const payload = (k: number): string => '{{a}'.repeat(k);

    const timeOf = (value: string): number => {
      const started = performance.now();
      for (let i = 0; i < 20; i += 1) isTemplate(value);
      return performance.now() - started;
    };

    it('answers a 100k-char run of "{" in well under a second', () => {
      const evil = '{'.repeat(100_000);
      const started = performance.now();
      const result = isTemplate(evil);
      const elapsed = performance.now() - started;

      expect(result).toBe(false);
      // The quadratic forms took ~9s (regex) / ~13s (naive scan) here.
      expect(elapsed).toBeLessThan(250);
    });

    it('scales ~linearly: 8x the input costs well under 16x the time', () => {
      const small = payload(20_000);
      const large = payload(160_000); // 8x

      // Warm up so JIT compilation isn't attributed to the larger input.
      timeOf(small);
      timeOf(large);

      const smallMs = Math.max(timeOf(small), 0.05); // floor: avoid divide-by-noise
      const largeMs = timeOf(large);

      // Linear predicts 8x. Quadratic predicts 64x. 16x cleanly separates the
      // two while leaving generous headroom for a noisy CI box.
      expect(largeMs / smallMs).toBeLessThan(16);
    });
  });
});
