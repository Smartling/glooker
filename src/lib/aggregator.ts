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
  typeBreakdown:  Record<string, number>;
  activeRepos:    string[];
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

    // Impact score: weighted blend of volume + complexity + PR discipline
    const rawImpact =
      Math.min(dev.commits.length / 20, 1) * 2 +
      Math.min(totalPRs / 10, 1)            * 3 +
      (avgComplexity / 10)                   * 3.5 +
      (prPercentage / 100)                   * 1.1;
    const impactScore = Math.round(rawImpact * 10) / 10;

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
      typeBreakdown,
      activeRepos:   [...dev.repos],
    });
  }

  return stats.sort((a, b) => b.impactScore - a.impactScore);
}
