import type { JiraClientInterface } from './types';
import type { JiraUser, JiraIssueData } from './client';

// Lazy-load mock identities to avoid bundling in production
let _identities: typeof import('../../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../../scripts/mock-identities');
  return _identities!;
}

/** Pull project keys out of `project in ("A", "B")` or `project = A`. */
function extractProjectKeys(jql: string): string[] {
  const inMatch = jql.match(/project\s+in\s*\(([^)]*)\)/i);
  if (inMatch) {
    return inMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, '').toUpperCase())
      .filter(Boolean);
  }
  const eqMatch = jql.match(/project\s*=\s*["']?([A-Za-z0-9_]+)["']?/i);
  return eqMatch ? [eqMatch[1].toUpperCase()] : [];
}

/**
 * Jira's status -> statusCategory mapping for our fixture statuses. A real
 * Jira instance derives this per-workflow; here it's just the fixed set of
 * statuses MOCK_EPICS / MOCK_RESEARCH_EPICS actually use.
 */
const STATUS_CATEGORY: Record<string, string> = {
  'In Progress': 'In Progress',
  Backlog: 'To Do',
  Done: 'Done',
  // Rejected sits in the Done category despite carrying no resolution date —
  // real Jira behaviour, and the reason buildTeamJql's Done clause needs the
  // `OR updated` window.
  Rejected: 'Done',
  Rollout: 'In Progress',
};

/**
 * Pull a status filter out of `statusCategory = "X"` or `status = "X"`.
 * Returns null when the JQL has neither clause (e.g. the `key in (...)`
 * initiative batch lookup), meaning "no status filtering".
 */
function extractStatusFilter(jql: string): { field: 'statusCategory' | 'status'; value: string } | null {
  const categoryMatch = jql.match(/statusCategory\s*=\s*["']([^"']+)["']/i);
  if (categoryMatch) return { field: 'statusCategory', value: categoryMatch[1] };

  const statusMatch = jql.match(/\bstatus\s*=\s*["']([^"']+)["']/i);
  if (statusMatch) return { field: 'status', value: statusMatch[1] };

  return null;
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

  async searchEpics(jql: string): Promise<Array<{
    key: string; summary: string; status: string; dueDate: string | null;
    assigneeDisplayName: string | null; assigneeEmail: string | null;
    parentKey: string | null; parentSummary: string | null; parentTypeName: string | null;
  }>> {
    const { MOCK_EPICS, MOCK_DEVELOPERS, MOCK_RESEARCH_EPICS } = getIdentities();

    const mockEpics = MOCK_EPICS.map(epic => {
      const dev = MOCK_DEVELOPERS.find(d => d.jiraEmail === epic.assigneeEmail);
      return {
        key: epic.key,
        summary: epic.summary,
        status: 'In Progress',
        dueDate: '2026-05-15' as string | null,
        assigneeDisplayName: dev?.githubName || null,
        assigneeEmail: epic.assigneeEmail as string | null,
        parentKey: epic.initiativeKey as string | null,
        parentSummary: epic.initiativeSummary as string | null,
        parentTypeName: 'Initiative' as string | null,
      };
    });

    // GLOOK-38: parentless research epics, so the flat-hierarchy path has data.
    const researchEpics = MOCK_RESEARCH_EPICS.map(epic => ({
      key: epic.key,
      summary: epic.summary,
      status: epic.status,
      dueDate: epic.dueDate,
      assigneeDisplayName: epic.assigneeName,
      assigneeEmail: epic.assigneeEmail,
      parentKey: null as string | null,
      parentSummary: null as string | null,
      parentTypeName: null as string | null,
    }));

    const all = [...mockEpics, ...researchEpics];

    // Honour a project clause so provenance sources don't cross-contaminate.
    // A JQL with no project clause (the `key in (...)` initiative batch lookup)
    // matches everything, preserving the previous behaviour.
    const keys = extractProjectKeys(jql);
    const byProject = keys.length === 0 ? all : all.filter(e => keys.includes(e.key.split('-')[0]));

    // Honour a status clause so board tabs (In Progress / Backlog / Done)
    // show distinct epics instead of the same set for every tab. A JQL with
    // neither a statusCategory nor a status clause (e.g. the batch lookup
    // above) matches everything, same as the project filter.
    const statusFilter = extractStatusFilter(jql);
    if (!statusFilter) return byProject;
    if (statusFilter.field === 'statusCategory') {
      return byProject.filter(e => STATUS_CATEGORY[e.status] === statusFilter.value);
    }
    return byProject.filter(e => e.status === statusFilter.value);
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

  async updateDueDate(_issueKey: string, _dueDate: string | null): Promise<void> {}

  async getTransitions(_issueKey: string): Promise<Array<{ id: string; name: string; to: { name: string } }>> {
    return [
      { id: '21', name: 'Start Rollout', to: { name: 'Rollout' } },
      { id: '31', name: 'Done', to: { name: 'Done' } },
    ];
  }

  async transitionIssue(_issueKey: string, _transitionId: string): Promise<void> {}
}
