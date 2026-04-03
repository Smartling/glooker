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

describe('JiraClient.getTransitions', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  const client = new JiraClient('mycompany.atlassian.net', 'user@example.com', 'token');

  it('calls GET /issue/{key}/transitions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ transitions: [] }),
    });
    await client.getTransitions('PROJ-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://mycompany.atlassian.net/rest/api/3/issue/PROJ-1/transitions');
    expect(options?.method).toBeUndefined(); // GET is the default
  });

  it('returns the transitions array from the response', async () => {
    const transitions = [
      { id: '11', name: 'To Do', to: { name: 'To Do' } },
      { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
      { id: '31', name: 'Done', to: { name: 'Done' } },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ transitions }),
    });

    const result = await client.getTransitions('PROJ-42');
    expect(result).toEqual(transitions);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Issue Not Found'),
    });

    await expect(client.getTransitions('PROJ-99')).rejects.toThrow(
      'Jira API error (404): Issue Not Found',
    );
  });
});

describe('JiraClient.transitionIssue', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  const client = new JiraClient('mycompany.atlassian.net', 'user@example.com', 'token');

  it('calls POST /issue/{key}/transitions with correct body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await client.transitionIssue('PROJ-42', '21');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://mycompany.atlassian.net/rest/api/3/issue/PROJ-42/transitions');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ transition: { id: '21' } });
  });

  it('resolves on 204 no content (ok: true, no .json())', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await expect(client.transitionIssue('PROJ-42', '31')).resolves.toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Transition not available'),
    });

    await expect(client.transitionIssue('PROJ-42', '99')).rejects.toThrow(
      'Jira API error (400): Transition not available',
    );
  });
});

describe('JiraClient.updateDueDate', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  const client = new JiraClient('mycompany.atlassian.net', 'user@example.com', 'token');

  it('calls PUT /issue/{key} with correct body for a date string', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await client.updateDueDate('PROJ-42', '2026-04-15');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://mycompany.atlassian.net/rest/api/3/issue/PROJ-42');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ fields: { duedate: '2026-04-15' } });
  });

  it('calls PUT /issue/{key} with null duedate to clear the date', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await client.updateDueDate('PROJ-42', null);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://mycompany.atlassian.net/rest/api/3/issue/PROJ-42');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ fields: { duedate: null } });
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });
    await expect(client.updateDueDate('PROJ-42', '2026-04-15')).rejects.toThrow(
      'Jira API error (403): Forbidden',
    );
  });
});
