// Shared renderer for the IN-FLIGHT WORK prompt block.
// Used by both the per-team projects generator (projects.ts) and the
// org-wide project-insights API route (project-insights/route.ts).
// Keeping one implementation ensures the pipe-delimited format stays
// consistent across both LLM surfaces.

import type { TeamProjectInflightPr, TeamProjectInflightBranch } from './data';

const MAX_TITLE_LEN = 100;

export function renderInflightBlock(
  prs: TeamProjectInflightPr[],
  branches: TeamProjectInflightBranch[],
): string {
  if (prs.length === 0 && branches.length === 0) return '';
  // Leading '\n' provides the blank-line separator between the preceding
  // prompt section and this block. The template omits the blank line so
  // there is no extra whitespace when the block is empty.
  const lines: string[] = ['\nIN-FLIGHT WORK (open PRs + bare branches — not yet merged):'];
  if (prs.length > 0) {
    lines.push('', `OPEN PRs (${prs.length}):`, 'repo|pr_title|author|+additions/-deletions|draft');
    for (const pr of prs) {
      lines.push(`${pr.repo}|${pr.title.slice(0, MAX_TITLE_LEN)}|${pr.author}|+${pr.additions}/-${pr.deletions}|${pr.is_draft ? 'yes' : 'no'}`);
    }
  }
  if (branches.length > 0) {
    lines.push('', `BARE BRANCHES (${branches.length}):`, 'repo|branch|author|commits|lines');
    for (const b of branches) {
      lines.push(`${b.repo}|${b.branch.slice(0, MAX_TITLE_LEN)}|${b.author}|${b.commit_count}|${b.lines}`);
    }
  }
  return lines.join('\n');
}
