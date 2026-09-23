import { clampExtract, MAX_TEXT } from '@/lib/chat/context/page-extract';
import { putPageExtract, takePageExtract, _resetPageStore } from '@/lib/chat/context/page-store';

describe('clampExtract', () => {
  it('collapses whitespace and trims', () => {
    const out = clampExtract({ path: ' /x ', title: 'A  \n B', heading: '', text: 'a  \n\n  b' });
    expect(out?.title).toBe('A B');
    expect(out?.text).toBe('a b');
    expect(out?.path).toBe('/x');
  });

  it('caps text at MAX_TEXT characters', () => {
    const out = clampExtract({ path: '/x', title: 't', heading: 'h', text: 'x'.repeat(MAX_TEXT + 5000) });
    expect(out!.text.length).toBe(MAX_TEXT);
  });

  it('tolerates missing fields', () => {
    const out = clampExtract({ path: '/x' });
    expect(out).toEqual({ path: '/x', title: '', heading: '', text: '' });
  });

  it('returns null for a non-object', () => {
    expect(clampExtract('nope')).toBeNull();
    expect(clampExtract(null)).toBeNull();
    expect(clampExtract(undefined)).toBeNull();
  });

  it('returns null when there is no usable content at all', () => {
    expect(clampExtract({ path: '/x', title: '', heading: '', text: '   ' })).toBeNull();
  });
});

describe('page store', () => {
  beforeEach(() => _resetPageStore());

  it('round-trips an extract by runId', () => {
    const e = { path: '/x', title: 't', heading: 'h', text: 'body' };
    putPageExtract('run-1', e);
    expect(takePageExtract('run-1')).toEqual(e);
  });

  it('is single-use — a second take returns undefined', () => {
    putPageExtract('run-1', { path: '/x', title: 't', heading: 'h', text: 'body' });
    takePageExtract('run-1');
    expect(takePageExtract('run-1')).toBeUndefined();
  });

  it('returns undefined for an unknown runId', () => {
    expect(takePageExtract('never-stored')).toBeUndefined();
  });
});
