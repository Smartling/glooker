import { buildDoneIssuesJql } from '@/lib/jira';

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
