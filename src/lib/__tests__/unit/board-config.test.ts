import {
  parseBoardConfig,
  validateBoardConfig,
  DEFAULT_BOARD_CONFIG,
  BoardConfigError,
} from '@/lib/teams/board-config';

describe('parseBoardConfig', () => {
  it('returns defaults for null (a team that has never been configured)', () => {
    expect(parseBoardConfig(null)).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('returns defaults for undefined', () => {
    expect(parseBoardConfig(undefined)).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('parses a JSON string (how SQLite stores it)', () => {
    const raw = JSON.stringify({ jiraProjectKeys: ['RND'], hierarchy: 'owner' });
    const cfg = parseBoardConfig(raw);
    expect(cfg.jiraProjectKeys).toEqual(['RND']);
    expect(cfg.hierarchy).toBe('owner');
  });

  it('parses an object (how mysql2 hands back a JSON column)', () => {
    const cfg = parseBoardConfig({ jiraProjectKeys: ['RND'], middleTab: 'Backlog' });
    expect(cfg.jiraProjectKeys).toEqual(['RND']);
    expect(cfg.middleTab).toBe('Backlog');
  });

  it('merges partial config over defaults', () => {
    const cfg = parseBoardConfig({ ringMode: 'jira' });
    expect(cfg.ringMode).toBe('jira');
    expect(cfg.hierarchy).toBe(DEFAULT_BOARD_CONFIG.hierarchy);
    expect(cfg.doneWindowDays).toBe(30);
    expect(cfg.includeRejected).toBe(false);
  });

  it('returns defaults for malformed JSON rather than throwing', () => {
    expect(parseBoardConfig('{not json')).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('ignores unknown keys when parsing stored data', () => {
    const cfg = parseBoardConfig({ hierarchy: 'owner', legacyKey: 'whatever' });
    expect(cfg.hierarchy).toBe('owner');
    expect(cfg as unknown as Record<string, unknown>).not.toHaveProperty('legacyKey');
  });
});

describe('validateBoardConfig', () => {
  it('accepts a full valid config', () => {
    const input = {
      jiraProjectKeys: ['RND'],
      hierarchy: 'owner',
      middleTab: 'Backlog',
      ringMode: 'jira',
      doneWindowDays: 30,
      includeRejected: true,
    };
    expect(validateBoardConfig(input)).toEqual(input);
  });

  it('accepts an empty object and fills defaults', () => {
    expect(validateBoardConfig({})).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('rejects an unknown key', () => {
    expect(() => validateBoardConfig({ bogus: 1 })).toThrow(BoardConfigError);
  });

  it('rejects an invalid hierarchy value', () => {
    expect(() => validateBoardConfig({ hierarchy: 'sideways' })).toThrow(/hierarchy/);
  });

  it('rejects an invalid middleTab value', () => {
    expect(() => validateBoardConfig({ middleTab: 'Sideways' })).toThrow(/middleTab/);
  });

  it('rejects an invalid ringMode value', () => {
    expect(() => validateBoardConfig({ ringMode: 'sparkles' })).toThrow(/ringMode/);
  });

  it('rejects doneWindowDays outside 1..365', () => {
    expect(() => validateBoardConfig({ doneWindowDays: 0 })).toThrow(/doneWindowDays/);
    expect(() => validateBoardConfig({ doneWindowDays: 366 })).toThrow(/doneWindowDays/);
    expect(() => validateBoardConfig({ doneWindowDays: 12.5 })).toThrow(/doneWindowDays/);
  });

  it('rejects jiraProjectKeys that is not an array of non-empty strings', () => {
    expect(() => validateBoardConfig({ jiraProjectKeys: 'RND' })).toThrow(/jiraProjectKeys/);
    expect(() => validateBoardConfig({ jiraProjectKeys: [''] })).toThrow(/jiraProjectKeys/);
    expect(() => validateBoardConfig({ jiraProjectKeys: [1] })).toThrow(/jiraProjectKeys/);
  });

  it('rejects a project key containing JQL-hostile characters', () => {
    expect(() => validateBoardConfig({ jiraProjectKeys: ['RND" OR 1=1'] })).toThrow(/jiraProjectKeys/);
  });

  it('trims and uppercases project keys', () => {
    expect(validateBoardConfig({ jiraProjectKeys: [' rnd '] }).jiraProjectKeys).toEqual(['RND']);
  });

  it('rejects a non-object input', () => {
    expect(() => validateBoardConfig('nope')).toThrow(BoardConfigError);
    expect(() => validateBoardConfig(null)).toThrow(BoardConfigError);
  });
});
