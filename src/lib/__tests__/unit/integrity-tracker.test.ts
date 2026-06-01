import { IntegrityTracker } from '@/lib/report-runner/integrity-tracker';
import { DEFAULT_THRESHOLDS } from '@/lib/report-runner/types';

describe('IntegrityTracker', () => {
  it('starts with empty skipped/errors arrays and the given expectedCount', () => {
    const t = new IntegrityTracker({ expectedCount: 102, thresholds: DEFAULT_THRESHOLDS });
    const snap = t.snapshot();
    expect(snap.expectedCount).toBe(102);
    expect(snap.skipped).toEqual([]);
    expect(snap.errors).toEqual([]);
    expect(snap.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('records a skip with classification', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordSkip('alice', 'github 404', 'unknown');
    const snap = t.snapshot();
    expect(snap.skipped).toEqual([{ login: 'alice', reason: 'github 404', classification: 'unknown' }]);
  });

  it('deduplicates skips by login (last-write-wins on classification)', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordSkip('alice', 'first error', 'unknown');
    t.recordSkip('alice', 'second error', 'expected');
    const snap = t.snapshot();
    expect(snap.skipped).toHaveLength(1);
    expect(snap.skipped[0].classification).toBe('expected');
    expect(snap.skipped[0].reason).toBe('second error');
  });

  it('truncates long reason / message strings to 500 chars', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    const long = 'x'.repeat(1000);
    t.recordSkip('alice', long, 'unknown');
    t.recordError({ context: 'openPRs', login: 'alice', message: long });
    const snap = t.snapshot();
    expect(snap.skipped[0].reason).toHaveLength(500);
    expect(snap.errors[0].message).toHaveLength(500);
  });

  it('records errors with context + optional login/sha', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordError({ context: 'openPRs', login: 'alice', message: 'ETIMEDOUT' });
    t.recordError({ context: 'sha-merge-check', sha: 'abc1234567', message: '403' });
    const snap = t.snapshot();
    expect(snap.errors).toEqual([
      { context: 'openPRs', login: 'alice', message: 'ETIMEDOUT' },
      { context: 'sha-merge-check', sha: 'abc1234567', message: '403' },
    ]);
  });

  it('snapshot returns a frozen, independent view (mutation does not affect tracker)', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordSkip('alice', 'err', 'unknown');
    const snap1 = t.snapshot();
    expect(() => { (snap1.skipped as any).push({ login: 'bob', reason: 'x', classification: 'unknown' }); }).toThrow();
    const snap2 = t.snapshot();
    expect(snap2.skipped).toHaveLength(1);
  });
});
