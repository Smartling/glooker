/**
 * GLOOK-13 regression (found 2026-09-02): reports silently under-collected for
 * days — 65 -> 64 -> 59 -> 51 developers — while integrity state stayed 'ok'.
 *
 * Mechanism: evaluateIntegrity() counted only 'unknown' skips, and
 * loadSkipClassifier() auto-flags any member skipped in >=4 of the last 5 runs.
 * So a member failed "loudly" for ~4 runs, then converted to 'auto-flagged' and
 * permanently left the health check's numerator. Each newly-failing member
 * followed the same path, which is why the loss was progressive and never
 * tripped a threshold.
 *
 * Verified against GitHub at the time: @junky had 28 commits in the window and
 * @ningjiang118 had 4, both absent from the report entirely. Both appear in
 * GLOOK-13's own May list of 41 skipped engineers, so both were auto-flagged.
 *
 * GLOOK-13's stated requirement is the spec these tests encode:
 *   "Today's 41/102 SKIPs (~40%) should have aborted the run, not silently
 *    shipped."
 *
 * Only a human-confirmed allowlist entry ('expected') may suppress the guard.
 * 'auto-flagged' is a *suggestion* surfaced in Settings for a human to promote
 * to the allowlist (see /api/settings/skip-allowlist autoFlaggedCandidates) —
 * it must not silence the alarm on its own.
 */
import { evaluateIntegrity } from '@/lib/report-runner/skip-classifier';
import { IntegrityTracker } from '@/lib/report-runner/integrity-tracker';
import { DEFAULT_THRESHOLDS, countableSkips, integrityCounts, formatIntegrityAbortReason, unverifiedCounts } from '@/lib/report-runner/types';
import type { UnverifiedMember } from '@/lib/report-runner/types';
import type { SkipClassification } from '@/lib/report-runner/types';

function snapshotWith(expectedCount: number, skips: Array<[string, SkipClassification]>) {
  const t = new IntegrityTracker({ expectedCount, thresholds: DEFAULT_THRESHOLDS });
  for (const [login, classification] of skips) t.recordSkip(login, 'boom', classification);
  return t.snapshot();
}

const many = (n: number, c: SkipClassification, prefix = 'u'): Array<[string, SkipClassification]> =>
  Array.from({ length: n }, (_, i) => [`${prefix}${i}`, c]);

describe('integrity guard counts auto-flagged skips (GLOOK-13 regression)', () => {
  it('aborts on the GLOOK-13 incident shape even when every skip is auto-flagged', () => {
    // The literal scenario GLOOK-13 was filed about: 41 of 102 dropped.
    expect(evaluateIntegrity(snapshotWith(102, many(41, 'auto-flagged')))).toBe('failed');
  });

  it('aborts on the 2026-09-02 shape: 13 chronic members lost from 101', () => {
    // 13/101 = 12.9% >= 10% and >= 5 absolute, so both halves of the
    // deliberate AND gate are satisfied.
    expect(evaluateIntegrity(snapshotWith(101, many(13, 'auto-flagged')))).toBe('failed');
  });

  it('still lets a human-allowlisted skip suppress the guard', () => {
    // 'expected' means a person reviewed this member and accepted the skip.
    expect(evaluateIntegrity(snapshotWith(101, many(41, 'expected')))).toBe('ok');
  });

  it('counts unknown and auto-flagged together rather than separately', () => {
    // 6 + 6 = 12 of 101 = 11.9%. Neither group alone reaches 10%.
    const mixed = [...many(6, 'unknown', 'a'), ...many(6, 'auto-flagged', 'b')];
    expect(evaluateIntegrity(snapshotWith(101, mixed))).toBe('failed');
  });

  it('excludes allowlisted members from the count but not the others', () => {
    // 3 auto-flagged of 100 hits the degraded count threshold (3), and the
    // 40 allowlisted skips must not push it to failed.
    const mixed = [...many(40, 'expected', 'ok'), ...many(3, 'auto-flagged', 'bad')];
    expect(evaluateIntegrity(snapshotWith(100, mixed))).toBe('degraded');
  });

  it('preserves the deliberate AND gate for abort', () => {
    // These two cases are pinned by the original GLOOK-13 suite as intended:
    // significant in absolute AND relative terms. Auto-flagged now counts, but
    // the gate itself is unchanged.
    expect(evaluateIntegrity(snapshotWith(100, many(6, 'auto-flagged')))).toBe('degraded'); // 6% < 10%
    expect(evaluateIntegrity(snapshotWith(10, many(4, 'auto-flagged')))).toBe('degraded');  // count 4 < 5
  });

  it('still reports ok with no skips', () => {
    expect(evaluateIntegrity(snapshotWith(101, []))).toBe('ok');
  });

  it('keeps auto-flagged skips visible in run_metadata while still counting them', () => {
    // Counting them must not remove them from the surfaced list — the badge
    // needs to name who was dropped. Asserts against countableSkips (the shared
    // predicate the badge and the runner use), not just the fixture, so this
    // fails if the predicate ever stops counting auto-flagged.
    const snap = snapshotWith(101, many(2, 'auto-flagged'));
    expect(snap.skipped).toHaveLength(2);
    expect(countableSkips(snap.skipped)).toHaveLength(2);
  });

  it('countableSkips counts unknown and auto-flagged, never allowlisted', () => {
    const snap = snapshotWith(100, [
      ...many(2, 'unknown', 'x'),
      ...many(3, 'auto-flagged', 'y'),
      ...many(4, 'expected', 'z'),
    ]);
    expect(countableSkips(snap.skipped).map(s => s.login).sort())
      .toEqual(['x0', 'x1', 'y0', 'y1', 'y2']);
  });
});

/**
 * The abort fired correctly and then misreported itself: report-runner and
 * IntegrityBadge each re-filtered for 'unknown', so an abort driven entirely by
 * auto-flagged members persisted "0 of 102 engineers couldn't be fetched (0%)"
 * into reports.error — telling the on-call that nothing was dropped, which is
 * the same class of silent misreporting this whole fix is about.
 */
describe('abort message agrees with the verdict that produced it', () => {
  it('names the real count on the GLOOK-13 shape instead of a false zero', () => {
    const snap = snapshotWith(102, many(41, 'auto-flagged'));
    expect(evaluateIntegrity(snap)).toBe('failed');

    const reason = formatIntegrityAbortReason(snap);
    expect(reason).toContain('41 of 102');
    expect(reason).toContain('(40%)');
    expect(reason).not.toContain('0 of 102');
    expect(reason).not.toContain('(0%)');
  });

  it('reports counts and denominator consistently when skips are mixed', () => {
    const snap = snapshotWith(100, [...many(6, 'unknown', 'u'), ...many(20, 'expected', 'a')]);
    // 20 allowlisted leave both numerator and denominator: 6 of 80 = 7.5% -> 8%.
    expect(formatIntegrityAbortReason(snap)).toContain('6 of 80');
  });
});

/**
 * The denominator has to shed allowlisted members too. Otherwise each allowlist
 * addition makes the percentage gate strictly less sensitive — and since the
 * thresholds are compile-time constants, promoting candidates into the
 * allowlist is the ONLY lever for unblocking a hard-failing run. The guard
 * would desensitise precisely as it gets used.
 */
describe('allowlisted members leave the denominator, not just the numerator', () => {
  it('does not let allowlist growth dilute the percentage gate', () => {
    // 6 genuine failures in a 100-member org with 40 allowlisted.
    // Against the full 100 that is 6% — under abortUnknownPct (10%), so it
    // would only degrade. Against the 60 members actually expected it is 10%,
    // which is the honest reading and aborts.
    const snap = snapshotWith(100, [...many(40, 'expected', 'a'), ...many(6, 'unknown', 'u')]);
    const { countable, allowlisted, effectiveExpected } = integrityCounts(snap);
    expect({ countable, allowlisted, effectiveExpected }).toEqual({
      countable: 6, allowlisted: 40, effectiveExpected: 60,
    });
    expect(evaluateIntegrity(snap)).toBe('failed');
  });

  it('still reports ok when every skip is allowlisted', () => {
    const snap = snapshotWith(101, many(41, 'expected'));
    expect(integrityCounts(snap).countable).toBe(0);
    expect(evaluateIntegrity(snap)).toBe('ok');
  });

  it('never produces a negative denominator', () => {
    // Defensive: expectedCount smaller than the allowlisted skip count.
    const snap = snapshotWith(2, many(5, 'expected'));
    expect(integrityCounts(snap).effectiveExpected).toBe(0);
    expect(integrityCounts(snap).countablePct).toBe(0);
    expect(evaluateIntegrity(snap)).toBe('ok');
  });
});

/**
 * GLOOK-50: an unverified member is kept in the report, so it must never abort
 * a run — but it must also not be invisible. Before this, an org-wide
 * issue-search brownout produced ZERO skips, so the state stayed 'ok', the
 * badge returned null, and every developer showed 0 merged PRs with their
 * impact score silently reshuffled. The doubt was written to run_metadata and
 * read by nothing.
 */
function withUnverified(expectedCount: number, n: number, field: UnverifiedMember['field'] = 'merged-prs') {
  return {
    expectedCount,
    thresholds: DEFAULT_THRESHOLDS,
    skipped: [] as never[],
    unverified: Array.from({ length: n }, (_, i) => ({
      login: `u${i}`, field, kept: 0, reason: 'search timed out',
    })),
  };
}

describe('unverified members downgrade a run without aborting it', () => {
  it('an org-wide brownout no longer reports a clean bill of health', () => {
    // 100 of 100 members unverified: the exact shape that shipped green.
    expect(evaluateIntegrity(withUnverified(100, 100))).toBe('degraded');
  });

  it('crosses to degraded at the 15% gate', () => {
    expect(evaluateIntegrity(withUnverified(100, 14))).toBe('ok');
    expect(evaluateIntegrity(withUnverified(100, 15))).toBe('degraded');
  });

  it('NEVER aborts, however many members are unverified', () => {
    // They are present in the report — losing the whole report over an
    // unverified PR count would be worse than the doubt it signals.
    expect(evaluateIntegrity(withUnverified(100, 100))).not.toBe('failed');
    expect(evaluateIntegrity(withUnverified(10, 10))).not.toBe('failed');
  });

  it('a handful of unverified members stays ok', () => {
    expect(evaluateIntegrity(withUnverified(100, 3))).toBe('ok');
  });

  it('counts each login once even when several figures are unverified', () => {
    // merged-prs AND reviews for the same person is one affected member.
    const snap = {
      expectedCount: 10,
      thresholds: DEFAULT_THRESHOLDS,
      skipped: [] as never[],
      unverified: [
        { login: 'a', field: 'merged-prs' as const, kept: 0, reason: 'x' },
        { login: 'a', field: 'reviews' as const, kept: 0, reason: 'x' },
      ],
    };
    expect(unverifiedCounts(snap).count).toBe(1);
  });

  it('excludes allowlisted members from the denominator, like the skip gate', () => {
    const snap = {
      expectedCount: 100,
      skipped: many(40, 'expected').map(([login, classification]) => ({
        login, reason: 'ok', classification,
      })),
      unverified: Array.from({ length: 9 }, (_, i) => ({
        login: `u${i}`, field: 'merged-prs' as const, kept: 0, reason: 'x',
      })),
    };
    // 9 of 60 real members = 15%, not 9 of 100 = 9%.
    expect(unverifiedCounts(snap).pct).toBeCloseTo(0.15, 5);
  });
});
