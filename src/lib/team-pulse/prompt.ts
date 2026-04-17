import type { TeamPulseData } from './data';

export function buildTeamPulsePrompt(data: TeamPulseData): string {
  const lines: string[] = [];

  for (const [login, m] of data.members) {
    lines.push(`@${login}`);
    const cur = m.current;
    const pri = m.prior;

    if (cur.commits === 0 && pri.commits === 0) {
      lines.push(`  Current: NO ACTIVITY`);
      lines.push(`  Prior: NO ACTIVITY`);
      if (m.totalReviews > 0) lines.push(`  Context: ${m.totalReviews} PR reviews this report period.`);
    } else if (cur.commits === 0) {
      lines.push(`  Current: NO ACTIVITY`);
      lines.push(`  Prior: ${pri.commits} commits, ${pri.prs} PRs, +${pri.linesAdded}/-${pri.linesRemoved} lines`);
      lines.push(`  Delta: went silent.`);
      if (m.totalReviews > 0) lines.push(`  Context: ${m.totalReviews} PR reviews this report period.`);
    } else if (pri.commits === 0) {
      lines.push(`  Current: ${cur.commits} commits, ${cur.prs} PRs, +${cur.linesAdded}/-${cur.linesRemoved} lines | Repos: ${m.currentRepos.join(', ') || '—'} | Types: ${m.currentTypes.join(', ') || '—'}`);
      lines.push(`  Prior: NO ACTIVITY`);
      lines.push(`  Delta: returned from inactivity.`);
    } else {
      const commitDelta = Math.round(((cur.commits - pri.commits) / pri.commits) * 100);
      const prDelta = pri.prs > 0 ? Math.round(((cur.prs - pri.prs) / pri.prs) * 100) : cur.prs > 0 ? 100 : 0;
      lines.push(`  Current: ${cur.commits} commits, ${cur.prs} PRs, +${cur.linesAdded}/-${cur.linesRemoved} lines | Repos: ${m.currentRepos.join(', ') || '—'} | Types: ${m.currentTypes.join(', ') || '—'}`);
      lines.push(`  Prior: ${pri.commits} commits, ${pri.prs} PRs, +${pri.linesAdded}/-${pri.linesRemoved} lines`);
      lines.push(`  Delta: commits ${commitDelta >= 0 ? '+' : ''}${commitDelta}%, PRs ${prDelta >= 0 ? '+' : ''}${prDelta}%.`);
    }

    if (cur.jiraIssues > 0 || pri.jiraIssues > 0) {
      lines.push(`  Jira: ${cur.jiraIssues} resolved (current), ${pri.jiraIssues} resolved (prior). SP: ${cur.storyPoints}.`);
    }
    lines.push('');
  }

  const formatDays = (days: string[]) => days.map(d => {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }).join(', ');

  return JSON.stringify({
    TEAM_NAME: data.teamName,
    CURRENT_WINDOW: formatDays(data.currentDays),
    PRIOR_WINDOW: formatDays(data.priorDays),
    TEAM_AVG_COMMITS: String(data.teamAvgCommits),
    TEAM_AVG_PRS: String(data.teamAvgPrs),
    ACTIVE_COUNT: String(data.activeCount),
    TOTAL_COUNT: String(data.totalCount),
    MEMBER_DATA: lines.join('\n'),
  });
}
