jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import db from '@/lib/db';
import { loadSkipClassifier, evaluateIntegrity } from '@/lib/report-runner/skip-classifier';
import { IntegrityTracker } from '@/lib/report-runner/integrity-tracker';
import { DEFAULT_THRESHOLDS } from '@/lib/report-runner/types';

const exec = db.execute as jest.Mock;

beforeEach(() => exec.mockReset());

describe('loadSkipClassifier', () => {
  it("returns 'expected' for logins in the allowlist", async () => {
    exec
      .mockResolvedValueOnce([[{ github_login: 'oshpak' }], []])
      .mockResolvedValueOnce([[], []]);
    const classify = await loadSkipClassifier();
    expect(classify('oshpak')).toBe('expected');
    expect(classify('alice')).toBe('unknown');
  });

  it("returns 'auto-flagged' for logins SKIPped in 4 of last 5 reports", async () => {
    const fiveRuns = [
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }, { login: 'alice' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'bob' }] }) },
    ];
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([fiveRuns, []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('auto-flagged');
    expect(classify('alice')).toBe('unknown');
    expect(classify('bob')).toBe('unknown');
  });

  it("returns 'expected' before 'auto-flagged' when both apply", async () => {
    exec
      .mockResolvedValueOnce([[{ github_login: 'pat' }], []])
      .mockResolvedValueOnce([Array(5).fill({ run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) }), []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('expected');
  });

  it('handles empty history gracefully', async () => {
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);
    const classify = await loadSkipClassifier();
    expect(classify('alice')).toBe('unknown');
  });

  it('handles malformed run_metadata rows without crashing', async () => {
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[
        { run_metadata: 'not-json' },
        { run_metadata: null },
        { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      ], []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('unknown'); // 1/5 < 4 threshold
  });

  it('accepts pre-parsed objects (MySQL JSON driver path)', async () => {
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([Array(4).fill({ run_metadata: { skipped: [{ login: 'pat' }] } }), []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('auto-flagged');
  });
});

describe('evaluateIntegrity', () => {
  function trackerWith(opts: { expectedCount: number; skips: Array<[string, 'expected'|'auto-flagged'|'unknown']> }) {
    const t = new IntegrityTracker({ expectedCount: opts.expectedCount, thresholds: DEFAULT_THRESHOLDS });
    for (const [login, classification] of opts.skips) t.recordSkip(login, 'err', classification);
    return t.snapshot();
  }

  it("returns 'ok' when no SKIPs", () => {
    expect(evaluateIntegrity(trackerWith({ expectedCount: 100, skips: [] }))).toBe('ok');
  });

  it("returns 'ok' when only expected SKIPs (1 expected, 100 members)", () => {
    expect(evaluateIntegrity(trackerWith({ expectedCount: 100, skips: [['oshpak', 'expected']] }))).toBe('ok');
  });

  it("returns 'degraded' when unknown count crosses degraded count threshold (3 unknown, 100 members)", () => {
    expect(evaluateIntegrity(trackerWith({
      expectedCount: 100,
      skips: [['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown']],
    }))).toBe('degraded');
  });

  it("returns 'degraded' when unknown pct crosses 5% (5 unknown, 100 members; count=5≥3 OR pct=5%≥5%)", () => {
    const tracker = trackerWith({
      expectedCount: 100,
      skips: [['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown'], ['d', 'unknown'], ['e', 'unknown']],
    });
    // 5 unknown / 100 = 5%; both abort conditions require BOTH count≥5 AND pct≥10%, so abort needs ≥10
    expect(evaluateIntegrity(tracker)).toBe('degraded');
  });

  it("returns 'failed' on the 5/28 incident shape (41 unknown / 102 members ≈ 40%)", () => {
    const skips: Array<[string, 'unknown']> = Array.from({ length: 41 }, (_, i) => [`u${i}`, 'unknown']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 102, skips }))).toBe('failed');
  });

  it("respects AND logic for abort — 6 unknown / 100 members = 6% does NOT abort (pct<10%)", () => {
    const skips: Array<[string, 'unknown']> = Array.from({ length: 6 }, (_, i) => [`u${i}`, 'unknown']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 100, skips }))).toBe('degraded');
  });

  it("respects AND logic for abort — 4 unknown / 10 members = 40% does NOT abort (count<5)", () => {
    const skips: Array<[string, 'unknown']> = Array.from({ length: 4 }, (_, i) => [`u${i}`, 'unknown']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 10, skips }))).toBe('degraded');
  });

  it("handles expectedCount = 0 without divide-by-zero (returns 'ok')", () => {
    expect(evaluateIntegrity(trackerWith({ expectedCount: 0, skips: [] }))).toBe('ok');
  });

  it('classifies 1 expected + 3 unknown / 100 members as degraded (count threshold)', () => {
    expect(evaluateIntegrity(trackerWith({
      expectedCount: 100,
      skips: [['oshpak', 'expected'], ['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown']],
    }))).toBe('degraded');
  });

  // Changed by the 2026-09-02 GLOOK-13 regression fix. This previously asserted
  // 'ok', which meant the exact incident GLOOK-13 was filed about (41 of 102
  // members dropped) passed the guard as soon as those members had been failing
  // long enough to be auto-flagged. Only a human allowlist entry ('expected')
  // may suppress the guard now. See integrity-guard-regression.test.ts.
  it("DOES count 'auto-flagged' against the threshold", () => {
    const skips: Array<[string, 'auto-flagged']> = Array.from({ length: 41 }, (_, i) => [`u${i}`, 'auto-flagged']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 102, skips }))).toBe('failed');
  });
});
