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
    INFLIGHT_BLOCK: renderInflightBlock(data.inflight),
  });
}

function renderInflightBlock(i: { open_prs: { total: number; draft: number; ready: number; oldest_days: number; lines_added: number; lines_removed: number; by_author: { login: string; count: number }[]; by_repo: { repo: string; count: number }[] }; unmerged_branches: { total_branches: number; total_commits: number } }): string {
  if (i.open_prs.total === 0 && i.unmerged_branches.total_commits === 0) {
    return 'IN-FLIGHT WORK (snapshot at report time): (none)';
  }
  const byRepo   = i.open_prs.by_repo.length === 0   ? '(none)' : i.open_prs.by_repo.map(r => `${r.repo} (${r.count})`).join(', ');
  const byAuthor = i.open_prs.by_author.length === 0 ? '(none)' : i.open_prs.by_author.map(a => `@${a.login} (${a.count})`).join(', ');
  return [
    'IN-FLIGHT WORK (snapshot at report time):',
    `- Open PRs: ${i.open_prs.total} (${i.open_prs.draft} draft, ${i.open_prs.ready} ready); oldest ${i.open_prs.oldest_days}d; +${i.open_prs.lines_added}/-${i.open_prs.lines_removed} lines`,
    `- Unmerged branches: ${i.unmerged_branches.total_branches} branches, ${i.unmerged_branches.total_commits} commits`,
    `- In-flight by repo:   ${byRepo}`,
    `- In-flight by author: ${byAuthor}`,
  ].join('\n');
}
