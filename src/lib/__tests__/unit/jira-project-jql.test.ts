import { buildProjectJql, DONE_WINDOW_DAYS } from '@/lib/jira-projects/jql';
import type { JiraProject } from '@/lib/jira-projects/types';

const SPS: JiraProject = {
  id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0,
};
const RND: JiraProject = {
  id: 'b', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research',
  activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1,
};

describe('SPS clause pin — regression guard', () => {
  // Measured on live Jira 2026-08-16: `status = "In Progress"` returns 46 SPS
  // epics, `statusCategory = "In Progress"` returns 71. The extra 25 are
  // Discovery, Rollout, Specs & Design and Ready for Dev — using the category
  // would double-list Rollout epics and surface pre-development work.
  it('uses status, never statusCategory, for the active tab', () => {
    const jql = buildProjectJql(SPS, 'active');
    expect(jql).toBe('project = "SPS" AND issuetype = Epic AND status = "In Progress"');
    expect(jql).not.toContain('statusCategory');
  });

  it('uses status for the middle tab', () => {
    expect(buildProjectJql(SPS, 'middle'))
      .toBe('project = "SPS" AND issuetype = Epic AND status = "Rollout"');
  });

  it('uses the Done category with a last-updated window for the done tab', () => {
    expect(buildProjectJql(SPS, 'done'))
      .toBe('project = "SPS" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d');
  });
});

describe('buildProjectJql for other projects', () => {
  it('builds RND tabs from its own status names', () => {
    expect(buildProjectJql(RND, 'active'))
      .toBe('project = "RND" AND issuetype = Epic AND status = "In Progress"');
    expect(buildProjectJql(RND, 'middle'))
      .toBe('project = "RND" AND issuetype = Epic AND status = "Backlog"');
  });

  it('uses the same Done clause for every project', () => {
    expect(buildProjectJql(RND, 'done'))
      .toBe('project = "RND" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d');
  });

  it('throws for the middle tab when the project has none', () => {
    expect(() => buildProjectJql({ ...RND, middleStatus: null }, 'middle'))
      .toThrow(/no middle tab/i);
  });

  it('exports the window as a named constant so the label can match', () => {
    expect(DONE_WINDOW_DAYS).toBe(30);
  });
});

describe('injection defence at the point of use', () => {
  it('rejects a project key that did not come through validation', () => {
    expect(() => buildProjectJql({ ...RND, projectKey: 'RND" OR key = "X' }, 'active'))
      .toThrow(/projectKey/);
  });

  it('rejects a status name containing a double quote', () => {
    expect(() => buildProjectJql({ ...RND, activeStatus: 'a"b' }, 'active')).toThrow(/activeStatus/);
    expect(() => buildProjectJql({ ...RND, middleStatus: 'a"b' }, 'middle')).toThrow(/middleStatus/);
  });

  it('rejects a status ending in a backslash, which would escape the closing quote', () => {
    expect(() => buildProjectJql({ ...RND, activeStatus: 'In Progress\\' }, 'active')).toThrow(/activeStatus/);
    expect(() => buildProjectJql({ ...RND, middleStatus: 'Backlog\\' }, 'middle')).toThrow(/middleStatus/);
  });

  it('rejects a backslash anywhere in a status name', () => {
    expect(() => buildProjectJql({ ...RND, activeStatus: 'In\\Progress' }, 'active')).toThrow(/activeStatus/);
  });

  it('rejects an interior newline in a status name', () => {
    expect(() => buildProjectJql({ ...RND, activeStatus: 'In\nProgress' }, 'active')).toThrow(/activeStatus/);
    expect(() => buildProjectJql({ ...RND, middleStatus: 'Roll\rout' }, 'middle')).toThrow(/middleStatus/);
  });

  it('throws a typed error rather than a TypeError for a null activeStatus', () => {
    expect(() => buildProjectJql({ ...RND, activeStatus: null as unknown as string }, 'active'))
      .toThrow(/activeStatus/);
  });

  it('still accepts status names Jira really uses', () => {
    // SPS genuinely has "Specs & Design" — do not over-restrict to a whitelist.
    expect(buildProjectJql({ ...SPS, activeStatus: 'Specs & Design' }, 'active'))
      .toBe('project = "SPS" AND issuetype = Epic AND status = "Specs & Design"');
  });
});
