// src/lib/__tests__/unit/vuln-overview-format.test.ts
// The Overview's change sentences: one wording and one tone for the Open tile and the trend header.
import { baselineUnavailableText, carriedFootnote, carriedTitle, changeSentence, changeToneClass, openChange, usableTotal } from '@/app/vulnerabilities/overview-format';
import { ovBaseline, ovDelta, ovDeltaTeam, ovNoBaseline } from '../support/security-fixtures';

// "Today" is passed in, so the year rule does not depend on the day the suite runs.
const TODAY = '2031-10-07';   // a year the suite never runs in, so a date that ignored `today` would print the wrong year

describe('changeSentence', () => {
  // Revert: swap the two arrows, or print the signed number ("▲ -3").
  it('reads "▲ N more than on <date>", "▼ N fewer than on <date>" or "Same as on <date>"', () => {
    expect(changeSentence(2, '2031-09-29', TODAY)).toBe('▲ 2 more than on Sep 29');
    expect(changeSentence(-1, '2031-09-29', TODAY)).toBe('▼ 1 fewer than on Sep 29');
    expect(changeSentence(0, '2031-09-29', TODAY)).toBe('Same as on Sep 29');
  });

  // Revert: print the ISO date, or drop the year rule.
  it('writes the date as a display date: no year in the current year, the year in any other, UTC', () => {
    expect(changeSentence(0, '2031-01-01', TODAY)).toBe('Same as on Jan 1');
    expect(changeSentence(0, '2030-12-31', TODAY)).toBe('Same as on Dec 31, 2030');
  });
});

describe('changeToneClass', () => {
  // Revert: use one colour for both severities, or colour a decrease red.
  it('more alerts is red for critical and orange for high; fewer is green; no change is grey', () => {
    expect(changeToneClass(5, 'critical')).toBe('text-red-400');
    expect(changeToneClass(5, 'high')).toBe('text-orange-400');
    expect(changeToneClass(-3, 'critical')).toBe('text-green-400');
    expect(changeToneClass(-3, 'high')).toBe('text-green-400');
    expect(changeToneClass(0, 'critical')).toBe('text-gray-500');
  });
});

describe('baselineUnavailableText', () => {
  // Revert: always name a date, or never name one.
  it('a null baseline names no date; a known baseline that does not measure this view names its date', () => {
    expect(baselineUnavailableText(ovNoBaseline(), TODAY)).toBe('No earlier measurement yet');
    expect(baselineUnavailableText(undefined, TODAY)).toBe('No earlier measurement yet');
    expect(baselineUnavailableText(ovDelta(null, { baseline: ovBaseline('2031-09-29') }), TODAY)).toBe('No measurement on or before Sep 29');
  });
});

describe('usableTotal and openChange', () => {
  // Revert: trust `available` alone and dereference the total.
  it('an available delta whose total is null is not usable and never throws', () => {
    const d = ovDelta(null, { available: true });
    expect(usableTotal(d)).toBeNull();
    const c = openChange(d, 'critical', TODAY);
    expect(c.hasChange).toBe(false);
    expect(c.delta).toBeNull();
    expect(c.text).toBe('No measurement on or before Sep 15, 2026');
    expect(c.text).not.toMatch(/NaN|undefined|null/);
  });

  it('an unavailable delta is not usable even if it carries a stale total', () => {
    expect(usableTotal(ovDelta(ovDeltaTeam('Total', 4), { available: false }))).toBeNull();
  });

  it('a usable delta gives the sentence, its tone and the number', () => {
    const c = openChange(ovDelta(ovDeltaTeam('Total', 2), { baseline: ovBaseline('2031-09-29') }), 'critical', TODAY);
    expect(c).toEqual({ text: '▲ 2 more than on Sep 29', toneClass: 'text-red-400', hasChange: true, delta: 2 });
  });

  it('no delta at all reads as no earlier measurement', () => {
    expect(openChange(undefined, 'high', TODAY)).toEqual({ text: 'No earlier measurement yet', toneClass: 'text-gray-500', hasChange: false, delta: null });
  });
});

describe('carried-resolved wording', () => {
  // Revert: reword either string (the tile and the table both read these).
  it('the † tooltip and footnote keep their wording', () => {
    expect(carriedTitle(3)).toBe('Includes 3 carried over from imported CSV history (archived repo with no alert data)');
    expect(carriedFootnote(3)).toBe('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.');
  });
});
