/**
 * Pure-logic tests for `MessageBubble`'s `splitParagraphs` helper.
 * Runs under the current workerd-based vitest pool.
 */
import { describe, it, expect } from 'vitest';
import { splitParagraphs } from '../components/MessageBubble';

describe('splitParagraphs', () => {
  it('returns [] for empty input', () => {
    expect(splitParagraphs('')).toEqual([]);
  });

  it('returns single paragraph when no blank lines', () => {
    expect(splitParagraphs('hello world')).toEqual(['hello world']);
  });

  it('splits on a single blank line', () => {
    expect(splitParagraphs('one\n\ntwo')).toEqual(['one', 'two']);
  });

  it('splits on multiple blank lines', () => {
    expect(splitParagraphs('one\n\n\n\ntwo')).toEqual(['one', 'two']);
  });

  it('preserves single newlines inside a paragraph', () => {
    expect(splitParagraphs('first\nsecond')).toEqual(['first\nsecond']);
  });

  it('normalises CRLF to LF', () => {
    expect(splitParagraphs('a\r\n\r\nb')).toEqual(['a', 'b']);
  });
});
