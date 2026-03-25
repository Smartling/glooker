import { buildDoneIssuesJql, JiraClient } from '@/lib/jira';

describe('buildDoneIssuesJql', () => {
  it('builds basic JQL without project filter', () => {
    const jql = buildDoneIssuesJql('abc123', 30);
    expect(jql).toBe(
      'assignee = "abc123" AND statusCategory = "Done" AND resolved >= -30d ORDER BY resolved DESC'
    );
  });

  it('builds JQL with project filter', () => {
    const jql = buildDoneIssuesJql('abc123', 14, ['PROJ1', 'PROJ2']);
    expect(jql).toContain('project IN ("PROJ1","PROJ2")');
    expect(jql).toContain('resolved >= -14d');
  });

  it('builds JQL with empty project filter (same as no filter)', () => {
    const jql = buildDoneIssuesJql('abc123', 7, []);
    expect(jql).not.toContain('project IN');
  });
});

describe('JiraClient.searchDoneIssues — story points mapping', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockResponse(issues: Array<{ key: string; fields: Record<string, any> }>) {
    return {
      ok: true,
      json: () => Promise.resolve({ issues, total: issues.length }),
    };
  }

  function baseFields(extra: Record<string, any> = {}) {
    return {
      summary: 'Test issue',
      status: { name: 'Done' },
      issuetype: { name: 'Story' },
      labels: [],
      created: '2024-01-01T00:00:00.000Z',
      resolutiondate: '2024-01-15T00:00:00.000Z',
      ...extra,
    };
  }

  const client = new JiraClient('mycompany.atlassian.net', 'user@example.com', 'token');

  it('returns null storyPoints when storyPointsFields is empty', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields() },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, []);
    expect(issues[0].storyPoints).toBeNull();
  });

  it('maps story points from a configured field', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10016: 5 }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10016']);
    expect(issues[0].storyPoints).toBe(5);
  });

  it('coerces string story point value to number', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10016: '8' }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10016']);
    expect(issues[0].storyPoints).toBe(8);
  });

  it('uses first non-null field when multiple fields are configured', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10028: null, customfield_10016: 3 }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10028', 'customfield_10016']);
    expect(issues[0].storyPoints).toBe(3);
  });

  it('returns null when all configured fields are null in the response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10016: null }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10016']);
    expect(issues[0].storyPoints).toBeNull();
  });
});
