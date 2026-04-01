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

export interface MockDeveloper {
  githubLogin: string;
  githubName: string;
  avatarUrl: string;
  jiraEmail: string;
  jiraAccountId: string;
  team: string;
}

export const MOCK_DEVELOPERS: MockDeveloper[] = [
  { githubLogin: 'alice-mock', githubName: 'Alice Chen', avatarUrl: 'https://i.pravatar.cc/150?u=alice', jiraEmail: 'alice@mockorg.dev', jiraAccountId: 'jira-alice-001', team: 'Platform' },
  { githubLogin: 'bob-mock', githubName: 'Bob Martinez', avatarUrl: 'https://i.pravatar.cc/150?u=bob', jiraEmail: 'bob@mockorg.dev', jiraAccountId: 'jira-bob-002', team: 'Platform' },
  { githubLogin: 'carol-mock', githubName: 'Carol Nguyen', avatarUrl: 'https://i.pravatar.cc/150?u=carol', jiraEmail: 'carol@mockorg.dev', jiraAccountId: 'jira-carol-003', team: 'Platform' },
  { githubLogin: 'dave-mock', githubName: 'Dave Kim', avatarUrl: 'https://i.pravatar.cc/150?u=dave', jiraEmail: 'dave@mockorg.dev', jiraAccountId: 'jira-dave-004', team: 'Frontend' },
  { githubLogin: 'eve-mock', githubName: 'Eve Patel', avatarUrl: 'https://i.pravatar.cc/150?u=eve', jiraEmail: 'eve@mockorg.dev', jiraAccountId: 'jira-eve-005', team: 'Frontend' },
  { githubLogin: 'frank-mock', githubName: 'Frank Osei', avatarUrl: 'https://i.pravatar.cc/150?u=frank', jiraEmail: 'frank@mockorg.dev', jiraAccountId: 'jira-frank-006', team: 'Frontend' },
  { githubLogin: 'grace-mock', githubName: 'Grace Liu', avatarUrl: 'https://i.pravatar.cc/150?u=grace', jiraEmail: 'grace@mockorg.dev', jiraAccountId: 'jira-grace-007', team: 'Data' },
  { githubLogin: 'hank-mock', githubName: 'Hank Russo', avatarUrl: 'https://i.pravatar.cc/150?u=hank', jiraEmail: 'hank@mockorg.dev', jiraAccountId: 'jira-hank-008', team: 'Data' },
];

export interface MockTeam {
  id: string;
  name: string;
  color: string;
}

export const MOCK_TEAMS: MockTeam[] = [
  { id: '00000000-0000-4000-b000-000000000001', name: 'Platform', color: '#2563EB' },
  { id: '00000000-0000-4000-b000-000000000002', name: 'Frontend', color: '#7C3AED' },
  { id: '00000000-0000-4000-b000-000000000003', name: 'Data', color: '#059669' },
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
