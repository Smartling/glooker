import { MockJiraClient } from '@/lib/jira/mock-client';

describe('MockJiraClient.searchEpics project filtering', () => {
  const client = new MockJiraClient();

  it('returns only MOCK epics for a MOCK project clause', async () => {
    const epics = await client.searchEpics('project in ("MOCK") AND issuetype = Epic');
    expect(epics.length).toBeGreaterThan(0);
    expect(epics.every(e => e.key.startsWith('MOCK-'))).toBe(true);
  });

  it('returns only research epics for an RSCH project clause', async () => {
    const epics = await client.searchEpics('project in ("RSCH") AND issuetype = Epic');
    expect(epics.length).toBeGreaterThan(0);
    expect(epics.every(e => e.key.startsWith('RSCH-'))).toBe(true);
  });

  it('handles the `project = X` form as well as `project in (...)`', async () => {
    const epics = await client.searchEpics('project = RSCH AND issuetype = Epic');
    expect(epics.every(e => e.key.startsWith('RSCH-'))).toBe(true);
  });

  it('gives research epics no parent, so the flat-hierarchy path is exercised', async () => {
    const epics = await client.searchEpics('project in ("RSCH")');
    expect(epics.every(e => e.parentKey === null && e.parentTypeName === null)).toBe(true);
  });

  it('gives MOCK epics an Initiative parent, as before', async () => {
    const epics = await client.searchEpics('project in ("MOCK")');
    expect(epics.every(e => e.parentTypeName === 'Initiative')).toBe(true);
  });

  it('returns everything when the JQL names no project (key in (...) batch lookup)', async () => {
    const epics = await client.searchEpics('key in ("MOCK-10","MOCK-20")');
    expect(epics.some(e => e.key.startsWith('MOCK-'))).toBe(true);
  });
});

describe('MockJiraClient.searchEpics status filtering', () => {
  const client = new MockJiraClient();

  it('filters to In Progress research epics via statusCategory', async () => {
    const epics = await client.searchEpics(
      'project in ("RSCH") AND issuetype = Epic AND statusCategory = "In Progress"',
    );
    expect(epics).toHaveLength(3);
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-101', 'RSCH-102', 'RSCH-103']);
  });

  it('filters to Backlog research epics via statusCategory = "To Do"', async () => {
    const epics = await client.searchEpics(
      'project in ("RSCH") AND issuetype = Epic AND statusCategory = "To Do"',
    );
    expect(epics).toHaveLength(2);
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-201', 'RSCH-202']);
  });

  it('filters to Done-category research epics via statusCategory = "Done"', async () => {
    const epics = await client.searchEpics(
      'project in ("RSCH") AND issuetype = Epic AND statusCategory = "Done"',
    );
    expect(epics).toHaveLength(2);
    // RSCH-302 is the Rejected epic: rejected hypotheses sit in the Done
    // statusCategory in real Jira despite carrying no resolution date, which
    // is exactly why buildProjectJql's Done clause filters on `updated`
    // rather than a resolution date.
    expect(epics.map(e => e.key)).toContain('RSCH-302');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-301', 'RSCH-302']);
  });

  it('filters to an exact status match via status = "Rollout"', async () => {
    const epics = await client.searchEpics(
      'project in ("RSCH") AND issuetype = Epic AND status = "Rollout"',
    );
    expect(epics).toHaveLength(0);
  });

  it('returns all research epics when the JQL carries no status clause', async () => {
    const epics = await client.searchEpics('project in ("RSCH") AND issuetype = Epic');
    expect(epics).toHaveLength(7);
  });

  it('composes the project and status filters rather than conflicting', async () => {
    const epics = await client.searchEpics(
      'project in ("MOCK") AND issuetype = Epic AND statusCategory = "In Progress"',
    );
    expect(epics).toHaveLength(4);
    expect(epics.every(e => e.key.startsWith('MOCK-'))).toBe(true);
  });
});

describe('MockJiraClient.searchEpics with buildProjectJql shapes (project = "KEY")', () => {
  const client = new MockJiraClient();

  it('filters the RSCH active tab by its status name', async () => {
    const epics = await client.searchEpics('project = "RSCH" AND issuetype = Epic AND status = "In Progress"');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-101', 'RSCH-102', 'RSCH-103']);
  });

  it('filters the RSCH middle tab by Backlog', async () => {
    const epics = await client.searchEpics('project = "RSCH" AND issuetype = Epic AND status = "Backlog"');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-201', 'RSCH-202']);
  });

  it('still returns rejected epics on the Done category', async () => {
    const epics = await client.searchEpics('project = "RSCH" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-301', 'RSCH-302']);
  });
});
