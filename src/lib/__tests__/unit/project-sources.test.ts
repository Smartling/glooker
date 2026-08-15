jest.mock('@/lib/teams/service', () => ({ listTeams: jest.fn() }));

import { buildTeamJql, resolveProjectSources, resolveBoardConfig } from '@/lib/projects/sources';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';
import { listTeams } from '@/lib/teams/service';

const mockListTeams = listTeams as jest.Mock;

const cfg = (over: Partial<typeof DEFAULT_BOARD_CONFIG> = {}) => ({ ...DEFAULT_BOARD_CONFIG, ...over });

beforeEach(() => jest.clearAllMocks());

describe('buildTeamJql', () => {
  it('builds the In Progress clause with statusCategory, not status', () => {
    const jql = buildTeamJql(['RND'], 'In Progress', cfg());
    expect(jql).toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "In Progress"');
  });

  it('maps Backlog to the To Do status category', () => {
    expect(buildTeamJql(['RND'], 'Backlog', cfg()))
      .toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "To Do"');
  });

  it('keeps Rollout as a literal status, since it is not a category', () => {
    expect(buildTeamJql(['RND'], 'Rollout', cfg()))
      .toBe('project in ("RND") AND issuetype = Epic AND status = "Rollout"');
  });

  it('uses resolved-only for Done when rejected work is excluded', () => {
    expect(buildTeamJql(['RND'], 'Done', cfg({ doneWindowDays: 30 })))
      .toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "Done" AND resolved >= -30d');
  });

  it('widens Done to updated when rejected work is included', () => {
    // RND-968 is Rejected: statusCategory Done, but resolutiondate is null, so
    // no `resolved >= -Nd` window can ever match it.
    expect(buildTeamJql(['RND'], 'Done', cfg({ includeRejected: true, doneWindowDays: 30 })))
      .toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "Done" AND (resolved >= -30d OR updated >= -30d)');
  });

  it('honours a custom doneWindowDays', () => {
    expect(buildTeamJql(['RND'], 'Done', cfg({ doneWindowDays: 14 })))
      .toContain('resolved >= -14d');
  });

  it('quotes and joins multiple project keys', () => {
    expect(buildTeamJql(['RND', 'LAB'], 'In Progress', cfg()))
      .toContain('project in ("RND", "LAB")');
  });

  it('throws when given no project keys', () => {
    expect(() => buildTeamJql([], 'In Progress', cfg())).toThrow(/at least one project key/i);
  });

  it('throws when a project key contains a double quote, naming the offending key', () => {
    expect(() => buildTeamJql(['RND" OR key = "X'], 'In Progress', cfg()))
      .toThrow(/RND" OR key = "X/);
  });

  it('throws when a project key is lowercase', () => {
    expect(() => buildTeamJql(['rnd'], 'In Progress', cfg()))
      .toThrow(/rnd/);
  });

  it('throws when a project key contains a space', () => {
    expect(() => buildTeamJql(['RN D'], 'In Progress', cfg()))
      .toThrow(/RN D/);
  });

  it('still produces the exact JQL for a valid multi-key list', () => {
    expect(buildTeamJql(['RND', 'LAB'], 'In Progress', cfg()))
      .toBe('project in ("RND", "LAB") AND issuetype = Epic AND statusCategory = "In Progress"');
  });
});

describe('resolveProjectSources', () => {
  it('returns only the global source when no team declares project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS' });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual({ kind: 'global', jql: 'project = SPS' });
  });

  it('adds one team source per team with project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS' });

    expect(sources).toHaveLength(2);
    expect(sources[1]).toEqual({
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: cfg({ jiraProjectKeys: ['RND'] }),
    });
  });

  it('narrows to a single team source when a team filter is given', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS', team: 'Research' });

    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('team');
  });

  it('excludes a configured team that the filter does not name', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
      { name: 'Labs', color: '#059669', board_config: cfg({ jiraProjectKeys: ['LAB'] }) },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS', team: 'Research' });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual({
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: cfg({ jiraProjectKeys: ['RND'] }),
    });
  });

  it('keeps the global source when the filtered team has no project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS', team: 'Platform' });

    expect(sources).toEqual([{ kind: 'global', jql: 'project = SPS' }]);
  });

  it('omits the global source when globalJql is absent', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    const sources = await resolveProjectSources('o', {});

    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('team');
  });
});

describe('resolveBoardConfig', () => {
  it('returns the config of a single named team that has one', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'], hierarchy: 'owner' }) },
    ]);

    expect((await resolveBoardConfig('o', 'Research'))!.hierarchy).toBe('owner');
  });

  it('returns null when no team is named (the mixed, unfiltered board)', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    expect(await resolveBoardConfig('o', null)).toBeNull();
  });

  it('returns null for a team with no project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
    ]);

    expect(await resolveBoardConfig('o', 'Platform')).toBeNull();
  });

  it('returns null for an unknown team name', async () => {
    mockListTeams.mockResolvedValue([]);
    expect(await resolveBoardConfig('o', 'Nope')).toBeNull();
  });
});
