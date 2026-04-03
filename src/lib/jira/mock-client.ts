import type { JiraClientInterface } from './types';
import type { JiraUser, JiraIssueData } from './client';

// Lazy-load mock identities to avoid bundling in production
let _identities: typeof import('../../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../../scripts/mock-identities');
  return _identities!;
}

export class MockJiraClient implements JiraClientInterface {
  async testConnection(): Promise<JiraUser> {
    return {
      accountId: 'mock-admin-001',
      displayName: 'Mock Admin',
      emailAddress: 'admin@mockorg.dev',
      active: true,
    };
  }

  async findUserByEmail(email: string): Promise<JiraUser | null> {
    const { MOCK_DEVELOPERS } = getIdentities();
    const dev = MOCK_DEVELOPERS.find(d => d.jiraEmail === email);
    if (!dev) return null;
    return {
      accountId: dev.jiraAccountId,
      displayName: dev.githubName,
      emailAddress: dev.jiraEmail,
      active: true,
    };
  }

  async searchEpics(_jql: string): Promise<Array<{
    key: string; summary: string; status: string; dueDate: string | null;
    assigneeDisplayName: string | null; assigneeEmail: string | null;
    parentKey: string | null; parentSummary: string | null; parentTypeName: string | null;
  }>> {
    const { MOCK_EPICS, MOCK_DEVELOPERS } = getIdentities();
    return MOCK_EPICS.map(epic => {
      const dev = MOCK_DEVELOPERS.find(d => d.jiraEmail === epic.assigneeEmail);
      return {
        key: epic.key,
        summary: epic.summary,
        status: 'In Progress',
        dueDate: '2026-05-15',
        assigneeDisplayName: dev?.githubName || null,
        assigneeEmail: epic.assigneeEmail,
        parentKey: epic.initiativeKey,
        parentSummary: epic.initiativeSummary,
        parentTypeName: 'Initiative',
      };
    });
  }

  async searchChildIssues(epicKey: string): Promise<Array<{
    key: string; summary: string; status: string; statusCategory: string;
    resolvedAt: string | null; assigneeEmail: string | null;
  }>> {
    const { MOCK_EPICS } = getIdentities();
    const epic = MOCK_EPICS.find(e => e.key === epicKey);
    const prefix = epicKey.split('-')[0];
    const num = parseInt(epicKey.split('-')[1]) || 100;
    return [
      { key: `${prefix}-${num + 50}`, summary: `Implement core logic for ${epic?.summary || epicKey}`, status: 'Done', statusCategory: 'Done', resolvedAt: '2026-03-28T10:00:00.000Z', assigneeEmail: epic?.assigneeEmail || null },
      { key: `${prefix}-${num + 51}`, summary: `Add tests for ${epic?.summary || epicKey}`, status: 'In Progress', statusCategory: 'In Progress', resolvedAt: null, assigneeEmail: epic?.assigneeEmail || null },
    ];
  }

  async searchDoneIssues(
    accountId: string,
    _periodDays: number,
    _projects?: string[],
    _storyPointsFields?: string[],
  ): Promise<JiraIssueData[]> {
    const { MOCK_DEVELOPERS } = getIdentities();
    const dev = MOCK_DEVELOPERS.find(d => d.jiraAccountId === accountId);
    if (!dev) return [];
    return [
      {
        issueKey: `MOCK-${accountId.charCodeAt(accountId.length - 1)}00`,
        projectKey: 'MOCK',
        issueType: 'Story',
        summary: `Completed task by ${dev.githubName}`,
        description: null,
        status: 'Done',
        labels: ['backend'],
        storyPoints: 3,
        originalEstimateSeconds: null,
        issueUrl: `https://mockorg.atlassian.net/browse/MOCK-999`,
        createdAt: '2026-03-15T10:00:00.000Z',
        resolvedAt: '2026-03-25T16:00:00.000Z',
      },
    ];
  }

  async updateDueDate(_issueKey: string, _dueDate: string | null): Promise<void> {
    // no-op in mock
  }
}
