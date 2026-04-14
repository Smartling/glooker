import type { CommitData } from './github';
import type { CommitAnalysis } from './analyzer';

export interface DeveloperStats {
  githubLogin:    string;
  githubName:     string;
  avatarUrl:      string;
  totalPRs:       number;
  totalCommits:   number;
  linesAdded:     number;
  linesRemoved:   number;
  avgComplexity:  number;
  impactScore:    number;
  prPercentage:   number;  // % of commits that went through a PR
  aiPercentage:   number;  // % of commits with confirmed or suspected AI assistance
  totalJiraIssues: number;
  totalStoryPoints: number;
  totalReviews: number;
  ccTotalCost: number;
  ccInputTokens: number;
  ccOutputTokens: number;
  ccSessions: number;
  typeBreakdown:  Record<string, number>;
  activeRepos:    string[];
}

/**
 * Compute impact score from developer metrics.
 * Exported so report-runner can recalculate after Jira data is attached.
 */
export function computeImpactScore(s: {
  totalCommits: number; totalPRs: number; avgComplexity: number;
  prPercentage: number; totalStoryPoints: number; totalJiraIssues: number;
  totalReviews: number;
}): number {
  const jiraFactor = s.totalStoryPoints > 0
    ? Math.min(s.totalStoryPoints / 15, 1)
    : Math.min(s.totalJiraIssues / 10, 1);
  const raw =
    Math.min(s.totalCommits / 20, 1) * 2 +
    Math.min(s.totalPRs / 10, 1)     * 2.7 +
    (s.avgComplexity / 10)            * 3.5 +
    (s.prPercentage / 100)            * 1.1 +
    jiraFactor                        * 0.5 +
    Math.min(s.totalReviews / 15, 1)  * 0.5;
  return Math.round(raw * 10) / 10;
}

export function aggregate(
  commits:   CommitData[],
  analyses:  Map<string, CommitAnalysis>,
  prCounts:  Map<string, number>,  // login → merged PR count
): DeveloperStats[] {
  const byDev = new Map<string, {
    commits:      CommitData[];
    analyses:     CommitAnalysis[];
    repos:        Set<string>;
    prCommits:    number;
    aiCommits:    number;  // confirmed + maybe_ai
    name:         string;
    avatarUrl:    string;
  }>();

  for (const c of commits) {
    if (!byDev.has(c.author)) {
      byDev.set(c.author, {
        commits:   [],
        analyses:  [],
        repos:     new Set(),
        prCommits: 0,
        aiCommits: 0,
        name:      c.authorName,
        avatarUrl: c.avatarUrl,
      });
    }
    const dev = byDev.get(c.author)!;
    dev.commits.push(c);
    dev.repos.add(c.repo);
    if (c.prNumber) dev.prCommits++;
    if (c.aiCoAuthored) {
      dev.aiCommits++;
    } else {
      const analysis = analyses.get(c.sha);
      if (analysis?.maybeAi) dev.aiCommits++;
    }
    const analysis = analyses.get(c.sha);
    if (analysis) dev.analyses.push(analysis);
  }

  const stats: DeveloperStats[] = [];

  for (const [login, dev] of byDev.entries()) {
    const totalPRs     = prCounts.get(login) || 0;
    const linesAdded   = dev.commits.reduce((s, c) => s + c.additions, 0);
    const linesRemoved = dev.commits.reduce((s, c) => s + c.deletions, 0);

    const complexities = dev.analyses.map((a) => a.complexity);
    const avgComplexity = complexities.length
      ? complexities.reduce((s, n) => s + n, 0) / complexities.length
      : 0;

    const prPercentage = dev.commits.length > 0
      ? Math.round((dev.prCommits / dev.commits.length) * 100)
      : 0;

    const aiPercentage = dev.commits.length > 0
      ? Math.round((dev.aiCommits / dev.commits.length) * 100)
      : 0;

    // Impact score: initial calculation without Jira data (recalculated in report-runner after Jira fetch)
    const impactScore = computeImpactScore({
      totalCommits: dev.commits.length, totalPRs, avgComplexity,
      prPercentage, totalStoryPoints: 0, totalJiraIssues: 0, totalReviews: 0,
    });

    const typeBreakdown: Record<string, number> = {};
    for (const a of dev.analyses) {
      typeBreakdown[a.type] = (typeBreakdown[a.type] || 0) + 1;
    }

    stats.push({
      githubLogin:   login,
      githubName:    dev.name,
      avatarUrl:     dev.avatarUrl,
      totalPRs,
      totalCommits:  dev.commits.length,
      linesAdded,
      linesRemoved,
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      impactScore,
      prPercentage,
      aiPercentage,
      totalJiraIssues: 0,  // Set by report-runner after Jira fetch
      totalStoryPoints: 0, // Set by report-runner after Jira fetch
      totalReviews: 0, // Set by report-runner after GitHub review count fetch
      ccTotalCost: 0,
      ccInputTokens: 0,
      ccOutputTokens: 0,
      ccSessions: 0,
      typeBreakdown,
      activeRepos:   [...dev.repos],
    });
  }

  return stats.sort((a, b) => b.impactScore - a.impactScore);
}
