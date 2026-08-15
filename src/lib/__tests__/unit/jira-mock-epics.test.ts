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
