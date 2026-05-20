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
});
