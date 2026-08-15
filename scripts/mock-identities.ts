// scripts/mock-identities.ts
// Single source of truth for all mock entity references.
// Both seed script and mock providers import from here.

export const MOCK_ORG = 'mock-org';

// Stable UUIDs so seed is idempotent across runs
export const MOCK_REPORT_IDS = {
  completed14d: '00000000-0000-4000-a000-000000000001',
  completed30d: '00000000-0000-4000-a000-000000000002',
  running:      '00000000-0000-4000-a000-000000000003',
};

export interface MockOpenPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
  commits: number;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
}

export interface MockDeveloper {
  githubLogin: string;
  githubName: string;
  avatarUrl: string;
  jiraEmail: string;
  jiraAccountId: string;
  team: string;
  mockOpenPrs?: MockOpenPr[];
}

export const MOCK_DEVELOPERS: MockDeveloper[] = [
  {
    githubLogin: 'alice-mock', githubName: 'Alice Chen', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', jiraEmail: 'alice@mockorg.dev', jiraAccountId: 'jira-alice-001', team: 'Platform',
    mockOpenPrs: [
      {
        repo: 'api-gateway',
        number: 8421,
        title: 'Refactor auth middleware for OAuth 2.1',
        url: 'https://github.com/mock-org/api-gateway/pull/8421',
        draft: false,
        commits: 6,
        additions: 284,
        deletions: 112,
        createdAt: '2026-04-03T10:00:00Z',
        updatedAt: '2026-04-21T12:00:00Z',
      },
      {
        repo: 'auth-service',
        number: 8433,
        title: 'WIP: token refresh edge case',
        url: 'https://github.com/mock-org/auth-service/pull/8433',
        draft: true,
        commits: 1,
        additions: 22,
        deletions: 4,
        createdAt: '2026-04-22T09:00:00Z',
        updatedAt: '2026-04-23T15:00:00Z',
      },
    ],
  },
  { githubLogin: 'bob-mock', githubName: 'Bob Martinez', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4', jiraEmail: 'bob@mockorg.dev', jiraAccountId: 'jira-bob-002', team: 'Platform' },
  { githubLogin: 'carol-mock', githubName: 'Carol Nguyen', avatarUrl: 'https://avatars.githubusercontent.com/u/3?v=4', jiraEmail: 'carol@mockorg.dev', jiraAccountId: 'jira-carol-003', team: 'Platform' },
  {
    githubLogin: 'dave-mock', githubName: 'Dave Kim', avatarUrl: 'https://avatars.githubusercontent.com/u/4?v=4', jiraEmail: 'dave@mockorg.dev', jiraAccountId: 'jira-dave-004', team: 'Frontend',
    mockOpenPrs: [
      {
        repo: 'dashboard-ui',
        number: 512,
        title: 'Add animations to chart components',
        url: 'https://github.com/mock-org/dashboard-ui/pull/512',
        draft: false,
        commits: 4,
        additions: 198,
        deletions: 60,
        createdAt: '2026-04-10T14:00:00Z',
        updatedAt: '2026-04-22T18:00:00Z',
      },
    ],
  },
  { githubLogin: 'eve-mock', githubName: 'Eve Patel', avatarUrl: 'https://avatars.githubusercontent.com/u/5?v=4', jiraEmail: 'eve@mockorg.dev', jiraAccountId: 'jira-eve-005', team: 'Frontend' },
  { githubLogin: 'frank-mock', githubName: 'Frank Osei', avatarUrl: 'https://avatars.githubusercontent.com/u/6?v=4', jiraEmail: 'frank@mockorg.dev', jiraAccountId: 'jira-frank-006', team: 'Frontend' },
  {
    githubLogin: 'grace-mock', githubName: 'Grace Liu', avatarUrl: 'https://avatars.githubusercontent.com/u/7?v=4', jiraEmail: 'grace@mockorg.dev', jiraAccountId: 'jira-grace-007', team: 'Data',
    mockOpenPrs: [
      {
        repo: 'data-pipeline',
        number: 207,
        title: 'ETL job scheduler v2',
        url: 'https://github.com/mock-org/data-pipeline/pull/207',
        draft: false,
        commits: 8,
        additions: 412,
        deletions: 190,
        createdAt: '2026-03-28T08:00:00Z',
        updatedAt: '2026-04-20T11:00:00Z',
      },
      {
        repo: 'data-pipeline',
        number: 214,
        title: 'WIP: snapshot test fixtures',
        url: 'https://github.com/mock-org/data-pipeline/pull/214',
        draft: true,
        commits: 2,
        additions: 47,
        deletions: 12,
        createdAt: '2026-04-21T16:00:00Z',
        updatedAt: '2026-04-23T10:00:00Z',
      },
    ],
  },
  { githubLogin: 'hank-mock', githubName: 'Hank Russo', avatarUrl: 'https://avatars.githubusercontent.com/u/8?v=4', jiraEmail: 'hank@mockorg.dev', jiraAccountId: 'jira-hank-008', team: 'Data' },
];

export interface MockTeam {
  id: string;
  name: string;
  color: string;
  /** GLOOK-38: per-team board behaviour. Omit for teams that use the default board. */
  boardConfig?: {
    jiraProjectKeys: string[];
    hierarchy: 'goal-initiative' | 'owner';
    middleTab: 'Rollout' | 'Backlog';
    ringMode: 'commits' | 'jira';
    doneWindowDays: number;
    includeRejected: boolean;
  };
}

export const MOCK_TEAMS: MockTeam[] = [
  { id: '00000000-0000-4000-b000-000000000001', name: 'Platform', color: '#2563EB' },
  { id: '00000000-0000-4000-b000-000000000002', name: 'Frontend', color: '#7C3AED' },
  { id: '00000000-0000-4000-b000-000000000003', name: 'Data', color: '#059669' },
  {
    id: '00000000-0000-4000-b000-000000000004',
    name: 'Research',
    color: '#0891B2',
    boardConfig: {
      jiraProjectKeys: ['RSCH'],
      hierarchy: 'owner',
      middleTab: 'Backlog',
      ringMode: 'jira',
      doneWindowDays: 30,
      includeRejected: true,
    },
  },
];

export interface MockEpic {
  key: string;
  summary: string;
  goalKey: string;
  goalSummary: string;
  initiativeKey: string;
  initiativeSummary: string;
  assigneeEmail: string;
}

export const MOCK_EPICS: MockEpic[] = [
  { key: 'MOCK-101', summary: 'Migrate auth to OAuth 2.1', goalKey: 'MOCK-1', goalSummary: 'Security Hardening', initiativeKey: 'MOCK-10', initiativeSummary: 'Auth Modernization', assigneeEmail: 'alice@mockorg.dev' },
  { key: 'MOCK-102', summary: 'Implement rate limiting middleware', goalKey: 'MOCK-1', goalSummary: 'Security Hardening', initiativeKey: 'MOCK-10', initiativeSummary: 'Auth Modernization', assigneeEmail: 'bob@mockorg.dev' },
  { key: 'MOCK-201', summary: 'Redesign dashboard components', goalKey: 'MOCK-2', goalSummary: 'User Experience Refresh', initiativeKey: 'MOCK-20', initiativeSummary: 'Frontend Overhaul', assigneeEmail: 'dave@mockorg.dev' },
  { key: 'MOCK-202', summary: 'Build data pipeline v2', goalKey: 'MOCK-2', goalSummary: 'User Experience Refresh', initiativeKey: 'MOCK-21', initiativeSummary: 'Data Infrastructure', assigneeEmail: 'grace@mockorg.dev' },
];

/**
 * GLOOK-38: research epics are deliberately parentless and span all three
 * board tabs, so the flat-hierarchy and Backlog paths are exercised in mock mode.
 * Assignee emails are intentionally NOT in MOCK_DEVELOPERS: a research team's
 * members may have no GitHub identity, which is exactly what provenance
 * attribution exists to handle.
 */
export interface MockResearchEpic {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
}

export const MOCK_RESEARCH_EPICS: MockResearchEpic[] = [
  { key: 'RSCH-101', summary: 'Hypothesis: retrieval improves summary faithfulness', status: 'In Progress', dueDate: '2026-05-20', assigneeName: 'Rita Solberg', assigneeEmail: 'rita@mockorg.dev' },
  { key: 'RSCH-102', summary: 'Benchmark small models against the house baseline', status: 'In Progress', dueDate: '2026-05-08', assigneeName: 'Rita Solberg', assigneeEmail: 'rita@mockorg.dev' },
  { key: 'RSCH-103', summary: 'Q2 prompt maintenance sweep', status: 'In Progress', dueDate: null, assigneeName: 'Ivo Brandt', assigneeEmail: 'ivo@mockorg.dev' },
  { key: 'RSCH-201', summary: 'Investigate structured output drift across versions', status: 'Backlog', dueDate: null, assigneeName: 'Ivo Brandt', assigneeEmail: 'ivo@mockorg.dev' },
  { key: 'RSCH-202', summary: 'Edit-nature assessment for post-edit signals', status: 'Backlog', dueDate: null, assigneeName: null, assigneeEmail: null },
  { key: 'RSCH-301', summary: 'Hypothesis: longer context reduces terminology error', status: 'Done', dueDate: '2026-03-31', assigneeName: 'Rita Solberg', assigneeEmail: 'rita@mockorg.dev' },
  { key: 'RSCH-302', summary: 'Fine-tuning is not worth the serving cost', status: 'Rejected', dueDate: '2026-03-15', assigneeName: 'Ivo Brandt', assigneeEmail: 'ivo@mockorg.dev' },
];
