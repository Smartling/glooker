// scripts/seed-data.ts
// Fixture data arrays for seeding the local SQLite database.
// All identifiers come from ./mock-identities.ts for consistency.

import {
  MOCK_ORG,
  MOCK_REPORT_IDS,
  MOCK_DEVELOPERS,
  MOCK_TEAMS,
  MOCK_EPICS,
} from './mock-identities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO timestamp N days ago from a fixed anchor (2026-04-01T00:00:00Z) */
function daysAgo(n: number): string {
  const anchor = new Date('2026-04-01T00:00:00Z');
  anchor.setDate(anchor.getDate() - n);
  return anchor.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Deterministic 40-char hex sha built from a seed string */
function fakeSha(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  // Repeat + trim to reach 40 chars, append seed length for uniqueness
  return (hex.repeat(6) + Math.abs(hash + seed.length).toString(16).padStart(8, '0')).slice(0, 40);
}

const R1 = MOCK_REPORT_IDS.completed14d;
const R2 = MOCK_REPORT_IDS.completed30d;
const R3 = MOCK_REPORT_IDS.running;
const completedReportIds = [R1, R2];

// ---------------------------------------------------------------------------
// 1. seedReports
// ---------------------------------------------------------------------------

export const seedReports = [
  { id: R1, org: MOCK_ORG, period_days: 14, status: 'completed', error: null, created_at: daysAgo(14), completed_at: daysAgo(1) },
  { id: R2, org: MOCK_ORG, period_days: 30, status: 'completed', error: null, created_at: daysAgo(30), completed_at: daysAgo(15) },
  { id: R3, org: MOCK_ORG, period_days: 14, status: 'running', error: null, created_at: daysAgo(0), completed_at: null },
];

// ---------------------------------------------------------------------------
// 2. seedDeveloperStats
// ---------------------------------------------------------------------------

interface DevProfile {
  impact: number;
  commits: number;
  prs: number;
  complexity: number;
  linesAdded: number;
  linesRemoved: number;
  aiPct: number;
  prPct: number;
  jiraIssues: number;
  typeBreakdown: Record<string, number>;
  activeRepos: string[];
}

const profiles: DevProfile[] = [
  // High performers (alice, bob)
  { impact: 8.5, commits: 18, prs: 11, complexity: 7.2, linesAdded: 2400, linesRemoved: 800, aiPct: 5,  prPct: 95,  jiraIssues: 6, typeBreakdown: { feature: 10, refactor: 4, bug: 2, test: 2 }, activeRepos: ['api-gateway', 'auth-service', 'shared-libs'] },
  { impact: 7.3, commits: 15, prs: 9,  complexity: 6.5, linesAdded: 1800, linesRemoved: 600, aiPct: 8,  prPct: 90,  jiraIssues: 5, typeBreakdown: { feature: 8, infra: 3, bug: 2, docs: 2 }, activeRepos: ['rate-limiter', 'api-gateway'] },
  // Mid performers (carol, dave, eve)
  { impact: 5.6, commits: 11, prs: 6,  complexity: 4.8, linesAdded: 900, linesRemoved: 350, aiPct: 12, prPct: 82,  jiraIssues: 4, typeBreakdown: { feature: 5, bug: 3, refactor: 2, test: 1 }, activeRepos: ['web-app', 'shared-libs'] },
  { impact: 4.9, commits: 9,  prs: 5,  complexity: 4.3, linesAdded: 750, linesRemoved: 280, aiPct: 15, prPct: 78,  jiraIssues: 3, typeBreakdown: { feature: 4, bug: 2, docs: 2, test: 1 }, activeRepos: ['dashboard-ui', 'design-system'] },
  { impact: 5.1, commits: 10, prs: 5,  complexity: 4.5, linesAdded: 820, linesRemoved: 310, aiPct: 10, prPct: 80,  jiraIssues: 3, typeBreakdown: { feature: 5, refactor: 3, test: 2 }, activeRepos: ['dashboard-ui', 'web-app'] },
  // Lower performers (frank, grace, hank)
  { impact: 2.8, commits: 5,  prs: 2,  complexity: 2.5, linesAdded: 320, linesRemoved: 120, aiPct: 18, prPct: 70,  jiraIssues: 2, typeBreakdown: { bug: 2, docs: 2, test: 1 }, activeRepos: ['design-system'] },
  { impact: 3.2, commits: 4,  prs: 2,  complexity: 3.0, linesAdded: 280, linesRemoved: 90,  aiPct: 6,  prPct: 65,  jiraIssues: 2, typeBreakdown: { feature: 2, infra: 1, docs: 1 }, activeRepos: ['data-pipeline', 'etl-jobs'] },
  { impact: 1.9, commits: 3,  prs: 1,  complexity: 2.2, linesAdded: 180, linesRemoved: 60,  aiPct: 20, prPct: 60,  jiraIssues: 2, typeBreakdown: { docs: 2, test: 1 }, activeRepos: ['data-pipeline'] },
];

export const seedDeveloperStats: Record<string, any>[] = [];
for (const rid of completedReportIds) {
  MOCK_DEVELOPERS.forEach((dev, i) => {
    const p = profiles[i];
    seedDeveloperStats.push({
      report_id: rid,
      github_login: dev.githubLogin,
      github_name: dev.githubName,
      avatar_url: dev.avatarUrl,
      total_prs: p.prs,
      total_commits: p.commits,
      lines_added: p.linesAdded,
      lines_removed: p.linesRemoved,
      avg_complexity: p.complexity,
      impact_score: p.impact,
      pr_percentage: p.prPct,
      ai_percentage: p.aiPct,
      total_jira_issues: p.jiraIssues,
      type_breakdown: JSON.stringify(p.typeBreakdown),
      active_repos: JSON.stringify(p.activeRepos),
    });
  });
}

// ---------------------------------------------------------------------------
// 3. seedCommitAnalyses
// ---------------------------------------------------------------------------

const commitTypes = ['feature', 'bug', 'refactor', 'docs', 'test'] as const;
const riskLevels = ['low', 'medium', 'high'] as const;
const repoPool = ['api-gateway', 'auth-service', 'shared-libs', 'rate-limiter', 'web-app', 'dashboard-ui', 'design-system', 'data-pipeline', 'etl-jobs'];
const commitMessages = [
  'Add OAuth 2.1 PKCE flow for public clients',
  'Fix race condition in token refresh logic',
  'Refactor middleware chain for extensibility',
  'Update API documentation for v3 endpoints',
  'Add integration tests for rate limiting',
  'Implement sliding window rate limiter',
  'Fix memory leak in connection pool',
  'Refactor database query builder',
  'Add changelog generation script',
  'Add unit tests for JWT validation',
  'Implement dashboard chart animations',
  'Fix date picker timezone handling',
  'Refactor component state management',
  'Update Storybook documentation',
  'Add E2E tests for login flow',
  'Build data ingestion pipeline v2',
  'Fix CSV parser edge case with quotes',
  'Refactor ETL job scheduler',
  'Update data model documentation',
  'Add snapshot tests for transformers',
];

export const seedCommitAnalyses: Record<string, any>[] = [];
let commitIdx = 0;

for (const rid of completedReportIds) {
  MOCK_DEVELOPERS.forEach((dev, devIdx) => {
    const numCommits = devIdx < 2 ? 5 : devIdx < 5 ? 4 : 3;
    for (let c = 0; c < numCommits; c++) {
      const msgIdx = (devIdx * 5 + c) % commitMessages.length;
      const typeIdx = (devIdx + c) % commitTypes.length;
      const riskIdx = (devIdx + c) % riskLevels.length;
      const repoIdx = (devIdx * 2 + c) % repoPool.length;
      const complexity = Math.min(10, Math.max(1, ((devIdx + c) * 3 + 2) % 10 + 1));
      const aiCoAuthored = (devIdx + c) % 7 === 0 ? 1 : 0;
      const maybeAi = (devIdx + c) % 5 === 0 ? 1 : 0;
      const sha = fakeSha(`${rid}-${dev.githubLogin}-${c}-commit`);
      commitIdx++;

      seedCommitAnalyses.push({
        report_id: rid,
        github_login: dev.githubLogin,
        author_email: dev.jiraEmail,
        repo: `${MOCK_ORG}/${repoPool[repoIdx]}`,
        commit_sha: sha,
        pr_number: commitIdx * 10 + c,
        pr_title: commitMessages[msgIdx],
        commit_message: commitMessages[msgIdx],
        lines_added: 20 + (commitIdx * 13) % 300,
        lines_removed: 5 + (commitIdx * 7) % 100,
        complexity,
        type: commitTypes[typeIdx],
        impact_summary: `${commitMessages[msgIdx]} - improves reliability and maintainability of the ${repoPool[repoIdx]} module.`,
        risk_level: riskLevels[riskIdx],
        ai_co_authored: aiCoAuthored,
        ai_tool_name: aiCoAuthored ? 'copilot' : null,
        maybe_ai: maybeAi,
        committed_at: daysAgo(Math.floor(c * 3 + devIdx + 1)),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 4. seedJiraIssues
// ---------------------------------------------------------------------------

const jiraSummaries = [
  'Implement PKCE auth flow',
  'Fix token refresh race condition',
  'Add rate limiting to public API',
  'Migrate user store to new schema',
  'Update onboarding wizard',
  'Fix dashboard loading state',
  'Add caching layer for queries',
  'Refactor event bus architecture',
  'Write API integration tests',
  'Update deployment runbook',
  'Redesign settings page',
  'Fix CSV export encoding',
  'Build ETL monitoring dashboard',
  'Add data validation rules',
  'Optimize query performance',
  'Update component library',
];

const issueTypes = ['Story', 'Task', 'Bug'];

export const seedJiraIssues: Record<string, any>[] = [];
let issueNum = 1000;

for (const rid of completedReportIds) {
  MOCK_DEVELOPERS.forEach((dev, devIdx) => {
    const numIssues = devIdx < 2 ? 3 : 2;
    for (let j = 0; j < numIssues; j++) {
      issueNum++;
      const summaryIdx = (devIdx * 3 + j) % jiraSummaries.length;
      const typeIdx = (devIdx + j) % issueTypes.length;
      seedJiraIssues.push({
        report_id: rid,
        github_login: dev.githubLogin,
        jira_account_id: dev.jiraAccountId,
        jira_email: dev.jiraEmail,
        project_key: 'MOCK',
        issue_key: `MOCK-${issueNum}`,
        issue_type: issueTypes[typeIdx],
        summary: jiraSummaries[summaryIdx],
        description: null,
        status: 'Done',
        labels: JSON.stringify(['sprint-42']),
        story_points: [1, 2, 3, 5, 8][j % 5],
        original_estimate_seconds: null,
        issue_url: `https://mockorg.atlassian.net/browse/MOCK-${issueNum}`,
        created_at: daysAgo(20 + j),
        resolved_at: daysAgo(3 + j),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 5. seedTeams
// ---------------------------------------------------------------------------

export const seedTeams = MOCK_TEAMS.map(t => ({
  id: t.id,
  org: MOCK_ORG,
  name: t.name,
  color: t.color,
  created_at: daysAgo(90),
}));

// ---------------------------------------------------------------------------
// 6. seedTeamMembers
// ---------------------------------------------------------------------------

export const seedTeamMembers = MOCK_DEVELOPERS.map(dev => {
  const team = MOCK_TEAMS.find(t => t.name === dev.team)!;
  return {
    team_id: team.id,
    github_login: dev.githubLogin,
    added_at: daysAgo(90),
  };
});

// ---------------------------------------------------------------------------
// 7. seedUserMappings
// ---------------------------------------------------------------------------

export const seedUserMappings = MOCK_DEVELOPERS.map(dev => ({
  org: MOCK_ORG,
  github_login: dev.githubLogin,
  jira_account_id: dev.jiraAccountId,
  jira_email: dev.jiraEmail,
  created_at: daysAgo(90),
}));

// ---------------------------------------------------------------------------
// 8. seedDeveloperSummaries
// ---------------------------------------------------------------------------

const summaryTexts = [
  'Alice delivered high-impact auth infrastructure work, leading the OAuth 2.1 migration. Her commits show strong architectural thinking and thorough test coverage.',
  'Bob drove critical rate-limiting features across the API gateway. His work improved system resilience and he consistently paired complex features with documentation.',
  'Carol contributed steadily to the web application, balancing feature work with bug fixes. She improved shared library reliability with targeted refactors.',
  'Dave focused on frontend improvements to the dashboard UI. His work modernized several key components and improved design system consistency.',
  'Eve delivered solid feature work across the dashboard and web app. She maintained good test coverage and contributed meaningful refactors.',
  'Frank addressed several UI bugs in the design system. His documentation updates helped onboard new team members.',
  'Grace built foundational data pipeline components. Her infrastructure work enables future scalability of the analytics platform.',
  'Hank contributed documentation improvements and test coverage for the data pipeline. His work focused on improving code quality.',
];

const badgeSets = [
  [{ label: 'Top Performer', icon: 'trophy' }, { label: 'Auth Expert', icon: 'shield' }],
  [{ label: 'Top Performer', icon: 'trophy' }, { label: 'Infra Champion', icon: 'server' }],
  [{ label: 'Consistent', icon: 'target' }],
  [{ label: 'UI Specialist', icon: 'palette' }],
  [{ label: 'Well-Rounded', icon: 'star' }],
  [{ label: 'Bug Hunter', icon: 'bug' }],
  [{ label: 'Rising Star', icon: 'rocket' }],
  [{ label: 'Quality Focus', icon: 'check-circle' }],
];

export const seedDeveloperSummaries: Record<string, any>[] = [];
for (const rid of completedReportIds) {
  MOCK_DEVELOPERS.forEach((dev, i) => {
    seedDeveloperSummaries.push({
      report_id: rid,
      github_login: dev.githubLogin,
      summary_text: summaryTexts[i],
      badges_json: JSON.stringify(badgeSets[i]),
      generated_at: daysAgo(1),
    });
  });
}

// ---------------------------------------------------------------------------
// 9. seedReportComparisons
// ---------------------------------------------------------------------------

export const seedReportComparisons = [
  {
    report_id_a: R1,
    report_id_b: R2,
    highlights_json: JSON.stringify([
      { type: 'improvement', text: 'Alice increased impact score from 7.8 to 8.5, driven by the OAuth migration project.' },
      { type: 'new_contributor', text: 'Hank joined the Data team and began contributing to the data pipeline.' },
      { type: 'trend', text: 'Overall AI co-authoring usage increased from 8% to 12% across the org.' },
    ]),
    generated_at: daysAgo(1),
  },
];

// ---------------------------------------------------------------------------
// 10. seedEpicSummaries
// ---------------------------------------------------------------------------

export const seedEpicSummaries = MOCK_EPICS.map((epic, i) => ({
  epic_key: epic.key,
  org: MOCK_ORG,
  summary_text: `Work on "${epic.summary}" progressed well this period. Key contributions include infrastructure changes and feature implementations that move the epic closer to completion.`,
  jira_resolved: 3 + i,
  jira_remaining: 2 + (i % 3),
  commit_count: 8 + i * 3,
  lines_added: 500 + i * 200,
  lines_removed: 150 + i * 60,
  repos: JSON.stringify([repoPool[i * 2 % repoPool.length], repoPool[(i * 2 + 1) % repoPool.length]]),
  generated_at: daysAgo(1),
}));

// ---------------------------------------------------------------------------
// 11. seedUntrackedSummaries
// ---------------------------------------------------------------------------

export const seedUntrackedSummaries = MOCK_TEAMS.map(team => ({
  team_name: team.name,
  org: MOCK_ORG,
  groups_json: JSON.stringify([
    { theme: 'Maintenance & housekeeping', commits: 4, description: 'Dependency updates, linting fixes, and CI config changes.' },
    { theme: 'Exploratory work', commits: 2, description: 'Spike on new caching strategy and prototype of alternate UI layout.' },
  ]),
  total_commits: 6,
  generated_at: daysAgo(1),
}));

// ---------------------------------------------------------------------------
// 12. seedSchedules
// ---------------------------------------------------------------------------

export const seedSchedules = [
  {
    id: '00000000-0000-4000-c000-000000000001',
    org: MOCK_ORG,
    period_days: 14,
    cron_expr: '0 9 * * 1',
    timezone: 'America/New_York',
    enabled: 1,
    test_mode: 0,
    last_run_at: null,
    last_report_id: null,
    created_at: daysAgo(30),
  },
];

// ---------------------------------------------------------------------------
// 13. seedReleaseNotes
// ---------------------------------------------------------------------------

export const seedReleaseNotes = [
  {
    latest_commit_sha: 'aabbccdd00112233445566778899aabbccddeeff',
    summary: [
      '- Added OAuth 2.1 PKCE authentication flow for public clients',
      '- Implemented sliding-window rate limiter for API gateway',
      '- Fixed race condition in token refresh logic',
      '- Redesigned dashboard chart components with animations',
      '- Added integration tests for rate limiting and JWT validation',
    ].join('\n'),
    commit_count: 8,
    generated_at: daysAgo(1),
  },
];
