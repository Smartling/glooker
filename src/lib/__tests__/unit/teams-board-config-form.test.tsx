/** @jest-environment jsdom */
import { buildBoardConfigPayload } from '@/app/settings/board-config-form';

describe('buildBoardConfigPayload', () => {
  it('returns null when no project keys are given, so the team keeps the default board', () => {
    expect(buildBoardConfigPayload({
      projectKeysRaw: '   ',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '30', includeRejected: true,
    })).toBeNull();
  });

  it('splits, trims and uppercases a comma-separated key list', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: ' rnd , lab ',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '30', includeRejected: true,
    })!;
    expect(payload.jiraProjectKeys).toEqual(['RND', 'LAB']);
  });

  it('coerces doneWindowDays to a number', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '14', includeRejected: false,
    })!;
    expect(payload.doneWindowDays).toBe(14);
    expect(payload.includeRejected).toBe(false);
  });

  it('drops empty entries from a trailing comma', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND,',
      hierarchy: 'goal-initiative', middleTab: 'Rollout', ringMode: 'commits',
      doneWindowDays: '30', includeRejected: false,
    })!;
    expect(payload.jiraProjectKeys).toEqual(['RND']);
  });

  it('falls back to 30 for an unparseable window', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: 'abc', includeRejected: true,
    })!;
    expect(payload.doneWindowDays).toBe(30);
  });
});
