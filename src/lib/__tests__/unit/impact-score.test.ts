import { computeImpactScore } from '@/lib/impact-score';

describe('computeImpactScore', () => {
  const base = {
    totalCommits: 0, totalPRs: 0, avgComplexity: 0,
    prPercentage: 0, totalStoryPoints: 0, totalJiraIssues: 0, totalReviews: 0,
  };

  it('returns 0 for an empty input', () => {
    expect(computeImpactScore(base)).toBe(0);
  });

  it('caps each additive term at its weight', () => {
    expect(computeImpactScore({ ...base, totalCommits: 100 })).toBe(2.0);
    expect(computeImpactScore({ ...base, totalPRs: 100 })).toBe(2.7);
    expect(computeImpactScore({ ...base, totalReviews: 100 })).toBe(0.5);
  });

  it('uses story points over jira issues when both are present', () => {
    expect(computeImpactScore({ ...base, totalStoryPoints: 15, totalJiraIssues: 2 })).toBe(0.5);
  });

  it('falls back to jira issues when story points is zero', () => {
    expect(computeImpactScore({ ...base, totalStoryPoints: 0, totalJiraIssues: 10 })).toBe(0.5);
  });

  it('rounds to one decimal place', () => {
    const score = computeImpactScore({ ...base, totalCommits: 7 });
    expect(score).toBe(0.7);
    expect(Number.isInteger(score * 10)).toBe(true);
  });

  describe('periodDays scaling (GLOOK-63)', () => {
    const busy = {
      ...base, totalCommits: 20, totalPRs: 10, avgComplexity: 6, prPercentage: 80,
      totalStoryPoints: 15, totalJiraIssues: 3, totalReviews: 15,
    };

    it('periodDays 14 is identical to omitting it', () => {
      for (const s of [base, busy, { ...base, totalCommits: 7 }, { ...busy, totalStoryPoints: 0 }]) {
        expect(computeImpactScore({ ...s, periodDays: 14 })).toBe(computeImpactScore(s));
      }
    });

    it('28 days doubles every volume cap', () => {
      const at28 = computeImpactScore({ ...busy, periodDays: 28 });
      const doubled = computeImpactScore({
        ...busy, totalCommits: 10, totalPRs: 5, totalStoryPoints: 7.5, totalReviews: 7.5,
      });
      expect(at28).toBe(doubled);
      expect(computeImpactScore({ ...base, totalJiraIssues: 20, periodDays: 28 })).toBe(0.5);
      expect(computeImpactScore({ ...base, totalJiraIssues: 10, periodDays: 28 })).toBe(0.3); // 0.25 rounds to 0.3
    });

    it('does not scale the complexity and PR-% terms', () => {
      const ratiosOnly = { ...base, avgComplexity: 10, prPercentage: 100 };
      expect(computeImpactScore({ ...ratiosOnly, periodDays: 365 })).toBe(computeImpactScore(ratiosOnly));
    });

    it('prPeriodDays scales only the PR and review caps', () => {
      const s = { ...base, totalCommits: 20, totalPRs: 10, totalReviews: 15 };
      // commits capped at 20*28/14=40 -> 0.5*2=1.0; PRs/reviews at 14 days -> full 2.7 + 0.5
      expect(computeImpactScore({ ...s, periodDays: 28, prPeriodDays: 14 })).toBe(4.2);
    });

    it('a zero period contributes nothing instead of NaN', () => {
      const s = computeImpactScore({ ...busy, periodDays: 0, prPeriodDays: 14 });
      expect(Number.isFinite(s)).toBe(true);
    });

    it('no PR coverage drops the PR/review terms and rescales the rest, never penalising', () => {
      // commits full (2) + complexity 10 (3.5) + PR% 100 (1.1) + jira full (0.5) = 7.1 of 7.1 possible -> 10.3
      const s = { ...base, totalCommits: 20, avgComplexity: 10, prPercentage: 100, totalJiraIssues: 10 };
      expect(computeImpactScore({ ...s, prPeriodDays: 0 })).toBe(10.3);
      expect(Number.isFinite(computeImpactScore({ ...s, periodDays: 0, prPeriodDays: 0 }))).toBe(true);
    });
  });
});
