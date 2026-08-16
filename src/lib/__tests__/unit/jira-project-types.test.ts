import { validateJiraProject, JiraProjectError } from '@/lib/jira-projects/types';

const valid = {
  projectKey: 'RND',
  displayName: 'LanguageAI Research',
  activeStatus: 'In Progress',
  middleStatus: 'Backlog',
  hierarchy: 'owner' as const,
  position: 1,
};

describe('validateJiraProject', () => {
  it('accepts a fully specified project', () => {
    expect(validateJiraProject(valid)).toEqual(valid);
  });

  it('uppercases and trims the project key', () => {
    expect(validateJiraProject({ ...valid, projectKey: ' rnd ' }).projectKey).toBe('RND');
  });

  it('defaults displayName to the project key when blank', () => {
    expect(validateJiraProject({ ...valid, displayName: '  ' }).displayName).toBe('RND');
  });

  it('defaults hierarchy and position when omitted', () => {
    const out = validateJiraProject({ projectKey: 'SPS', activeStatus: 'In Progress' });
    expect(out.hierarchy).toBe('goal-initiative');
    expect(out.position).toBe(0);
    expect(out.middleStatus).toBeNull();
  });

  it('treats a blank middleStatus as null, meaning a two-tab board', () => {
    expect(validateJiraProject({ ...valid, middleStatus: '   ' }).middleStatus).toBeNull();
  });

  it('rejects a project key with JQL-hostile characters', () => {
    expect(() => validateJiraProject({ ...valid, projectKey: 'RND" OR key = "X' })).toThrow(/projectKey/);
  });

  it('rejects a project key that does not start with a letter', () => {
    expect(() => validateJiraProject({ ...valid, projectKey: '1ND' })).toThrow(/projectKey/);
  });

  it('rejects a missing project key', () => {
    expect(() => validateJiraProject({ activeStatus: 'In Progress' })).toThrow(JiraProjectError);
  });

  it('rejects a missing activeStatus', () => {
    expect(() => validateJiraProject({ projectKey: 'SPS' })).toThrow(/activeStatus/);
  });

  it('rejects a status name containing a double quote', () => {
    expect(() => validateJiraProject({ ...valid, activeStatus: 'In "Progress"' })).toThrow(/activeStatus/);
    expect(() => validateJiraProject({ ...valid, middleStatus: 'Roll"out' })).toThrow(/middleStatus/);
  });

  it('rejects an invalid hierarchy', () => {
    expect(() => validateJiraProject({ ...valid, hierarchy: 'sideways' })).toThrow(/hierarchy/);
  });

  it('rejects a non-integer position', () => {
    expect(() => validateJiraProject({ ...valid, position: 1.5 })).toThrow(/position/);
  });

  it('rejects an unknown key', () => {
    expect(() => validateJiraProject({ ...valid, ringMode: 'jira' })).toThrow(/Unknown/);
  });

  it('rejects a non-object', () => {
    expect(() => validateJiraProject('nope')).toThrow(JiraProjectError);
    expect(() => validateJiraProject(null)).toThrow(JiraProjectError);
  });

  it('rejects a status name ending in a backslash, which would escape the closing quote', () => {
    expect(() => validateJiraProject({ ...valid, activeStatus: 'Rollout\\' })).toThrow(/activeStatus/);
    expect(() => validateJiraProject({ ...valid, middleStatus: 'Backlog\\' })).toThrow(/middleStatus/);
  });

  it('rejects a status name containing a backslash anywhere', () => {
    expect(() => validateJiraProject({ ...valid, activeStatus: 'In\\Progress' })).toThrow(/activeStatus/);
  });

  it('still accepts status names with characters Jira really uses', () => {
    // SPS genuinely has a "Specs & Design" status; do not over-restrict.
    expect(validateJiraProject({ ...valid, activeStatus: 'Specs & Design' }).activeStatus).toBe('Specs & Design');
    expect(validateJiraProject({ ...valid, activeStatus: 'Ready for Dev (QA)' }).activeStatus).toBe('Ready for Dev (QA)');
  });

  it('rejects a negative position', () => {
    expect(() => validateJiraProject({ ...valid, position: -1 })).toThrow(/position/);
  });
});
