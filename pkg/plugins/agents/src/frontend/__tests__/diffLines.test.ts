/**
 * Pure-logic tests for the inline differ used by `FileDiffViewer`.
 * Runs in the workerd test pool — no DOM dependency.
 */
import { describe, it, expect } from 'vitest';
import { diffLines } from '../components/FileDiffViewer';

describe('diffLines', () => {
  it('returns added lines when before is empty (file creation)', () => {
    const out = diffLines('', 'a\nb\nc');
    expect(out.map((l) => l.kind)).toEqual(['added', 'added', 'added']);
    expect(out.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('returns removed lines when after is empty (file deletion)', () => {
    const out = diffLines('a\nb', '');
    expect(out.map((l) => l.kind)).toEqual(['removed', 'removed']);
  });

  it('marks identical content as context only', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc');
    expect(out.every((l) => l.kind === 'context')).toBe(true);
  });

  it('detects a single-line change', () => {
    const out = diffLines('a\nold\nc', 'a\nnew\nc');
    const added = out.filter((l) => l.kind === 'added');
    const removed = out.filter((l) => l.kind === 'removed');
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('new');
    expect(removed).toHaveLength(1);
    expect(removed[0].text).toBe('old');
  });

  it('detects an insertion', () => {
    const out = diffLines('a\nc', 'a\nb\nc');
    const added = out.filter((l) => l.kind === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('b');
  });

  it('detects a deletion', () => {
    const out = diffLines('a\nb\nc', 'a\nc');
    const removed = out.filter((l) => l.kind === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].text).toBe('b');
  });
});
