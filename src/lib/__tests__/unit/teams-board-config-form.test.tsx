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

  it('passes an unparseable window through as NaN, rather than silently falling back to 30', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: 'abc', includeRejected: true,
    })!;
    expect(payload.doneWindowDays).toBeNaN();
  });

  it('passes an out-of-range window (500) through unclamped, for the server to reject', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '500', includeRejected: true,
    })!;
    expect(payload.doneWindowDays).toBe(500);
  });

  it('passes an out-of-range window (0) through unclamped, for the server to reject', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '0', includeRejected: true,
    })!;
    expect(payload.doneWindowDays).toBe(0);
  });

  it('passes a negative window (-5) through unclamped, for the server to reject', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '-5', includeRejected: true,
    })!;
    expect(payload.doneWindowDays).toBe(-5);
  });
});
