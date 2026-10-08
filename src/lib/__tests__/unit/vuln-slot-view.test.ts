// src/lib/__tests__/unit/vuln-slot-view.test.ts
// The one rule for reading a data slot (slot-view.ts): own data wins, then an error, then "unavailable", else loading.
import { REFRESH_FAILED_NOTE, UNAVAILABLE_TEXT, slotView } from '@/app/vulnerabilities/slot-view';
import { slot } from '../support/security-fixtures';

const DATA = { n: 1 };
const UNAVAILABLE = { available: false as const, reason: 'No sync has run yet.' };

describe('slotView', () => {
  // Revert: test errorText before data: a failed refresh would then replace figures that are still good.
  it('own data wins over an error: the data stays, the error becomes a refresh note', () => {
    expect(slotView(slot(DATA, { errorText: "Couldn't load x: y" }))).toEqual({ kind: 'data', data: DATA, dimmed: false, refreshError: "Couldn't load x: y" });
  });

  it('data with nothing wrong is plain data; stale data is dimmed', () => {
    expect(slotView(slot(DATA))).toEqual({ kind: 'data', data: DATA, dimmed: false, refreshError: null });
    expect(slotView(slot(DATA, { stale: true }))).toEqual({ kind: 'data', data: DATA, dimmed: true, refreshError: null });
  });

  it('stale data whose same key also failed is both: dimmed and carrying the note', () => {
    expect(slotView(slot(DATA, { stale: true, errorText: 'e' }))).toEqual({ kind: 'data', data: DATA, dimmed: true, refreshError: 'e' });
  });

  it('data that is falsy but present is still data', () => {
    expect(slotView(slot(0 as number, { loading: false })).kind).toBe('data');
  });

  it('with no data, an error is the answer, and it beats "unavailable"', () => {
    expect(slotView(slot<typeof DATA>(undefined, { errorText: 'e', loading: false }))).toEqual({ kind: 'error', text: 'e' });
    expect(slotView(slot<typeof DATA>(undefined, { errorText: 'e', unavailable: UNAVAILABLE, loading: false })).kind).toBe('error');
  });

  // Revert: fall through to loading for an unavailable answer: "Loading…" forever.
  it('with no data and an unavailable answer: a short text, the server\'s reason as its title', () => {
    expect(slotView(slot<typeof DATA>(undefined, { unavailable: UNAVAILABLE, loading: false }))).toEqual({ kind: 'unavailable', text: UNAVAILABLE_TEXT, title: 'No sync has run yet.' });
  });

  it('with nothing at all it is loading, whether or not the slot says so', () => {
    expect(slotView(slot<typeof DATA>(undefined, { loading: true })).kind).toBe('loading');
    expect(slotView(slot<typeof DATA>(undefined, { loading: false })).kind).toBe('loading');
  });

  it('the two texts are the ones the sections print', () => {
    expect(REFRESH_FAILED_NOTE).toBe("Couldn't refresh · showing last load");
    expect(UNAVAILABLE_TEXT).toBe('Not available yet');
  });
});
