import { stripInvisible, sanitizeAuthorName } from '@/lib/sanitize';

describe('stripInvisible', () => {
  it('returns empty string for empty / null / undefined input', () => {
    expect(stripInvisible('')).toBe('');
    expect(stripInvisible(null as any)).toBe('');
    expect(stripInvisible(undefined as any)).toBe('');
  });

  it('passes through normal printable ASCII', () => {
    expect(stripInvisible('hello world')).toBe('hello world');
    expect(stripInvisible('def foo(x): return x * 2')).toBe('def foo(x): return x * 2');
  });

  it('preserves \\t, \\n, \\r', () => {
    expect(stripInvisible('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('strips Unicode tag characters (U+E0020 — U+E007F) — the PI-05 / PI-07 vector', () => {
    const injected = 'hello\u{E0049}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065} world';
    expect(stripInvisible(injected)).toBe('hello world');
  });

  it('strips zero-width and bidi characters', () => {
    const zwsp = 'a​b‌c‍d﻿e';   // ZWSP, ZWNJ, ZWJ, BOM
    expect(stripInvisible(zwsp)).toBe('abcde');
    const bidi = 'x‮y‬z';                  // RLO, PDF
    expect(stripInvisible(bidi)).toBe('xyz');
  });

  it('strips C0 control chars (U+0001 — U+001F) except \\t \\n \\r', () => {
    expect(stripInvisible('abcd')).toBe('abcd');
  });

  it('preserves non-ASCII printable characters (e.g. accented, CJK)', () => {
    expect(stripInvisible('café 日本')).toBe('café 日本');
  });
});

describe('sanitizeAuthorName', () => {
  it('returns empty string for empty / null / undefined input', () => {
    expect(sanitizeAuthorName('')).toBe('');
    expect(sanitizeAuthorName(null as any)).toBe('');
    expect(sanitizeAuthorName(undefined as any)).toBe('');
  });

  it('passes through printable ASCII', () => {
    expect(sanitizeAuthorName('John Smith')).toBe('John Smith');
    expect(sanitizeAuthorName('user.name+tag@example.com')).toBe('user.name+tag@example.com');
  });

  it('strips non-ASCII (PI-06 carrier)', () => {
    expect(sanitizeAuthorName('José Smith')).toBe('Jos Smith');
  });

  it('strips Unicode tag chars (PI-06)', () => {
    const injected = 'John\u{E0049}\u{E0067}\u{E006E} Smith';
    expect(sanitizeAuthorName(injected)).toBe('John Smith');
  });

  it('caps length at 80 by default', () => {
    const long = 'x'.repeat(500);
    expect(sanitizeAuthorName(long)).toHaveLength(80);
  });

  it('honors custom maxLen', () => {
    expect(sanitizeAuthorName('abcdefghij', 5)).toBe('abcde');
  });
});
