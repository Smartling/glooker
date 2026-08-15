jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import { listTeams, createTeam, updateTeam } from '@/lib/teams/service';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([[], null]);
});

describe('listTeams board_config', () => {
  it('parses a stored JSON string into a BoardConfig', async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: 't1', org: 'o', name: 'Research', color: '#7C3AED',
        board_config: JSON.stringify({ jiraProjectKeys: ['RND'], hierarchy: 'owner' }),
        created_at: '2026-08-01',
      }], null])
      .mockResolvedValueOnce([[], null]); // team_members

    const teams = await listTeams('o');

    expect(teams[0].board_config.jiraProjectKeys).toEqual(['RND']);
    expect(teams[0].board_config.hierarchy).toBe('owner');
  });

  it('yields defaults when the column is NULL', async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: 't1', org: 'o', name: 'Platform', color: '#2563EB',
        board_config: null, created_at: '2026-08-01',
      }], null])
      .mockResolvedValueOnce([[], null]);

    const teams = await listTeams('o');

    expect(teams[0].board_config).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('selects the board_config column', async () => {
    await listTeams('o');
    expect(mockExecute.mock.calls[0][0]).toContain('board_config');
  });
});

describe('createTeam board_config', () => {
  it('persists a validated config as JSON', async () => {
    await createTeam({
      org: 'o', name: 'Research',
      boardConfig: { jiraProjectKeys: ['rnd'], hierarchy: 'owner' },
    });

    const insert = mockExecute.mock.calls.find(c => /INSERT INTO teams/.test(c[0]));
    expect(insert).toBeDefined();
    expect(insert![0]).toContain('board_config');
    const stored = JSON.parse(insert![1][4]);
    expect(stored.jiraProjectKeys).toEqual(['RND']); // uppercased by validation
  });

  it('stores NULL when no config is supplied', async () => {
    await createTeam({ org: 'o', name: 'Platform' });
    const insert = mockExecute.mock.calls.find(c => /INSERT INTO teams/.test(c[0]));
    expect(insert![1][4]).toBeNull();
  });

  it('rejects an invalid config', async () => {
    await expect(
      createTeam({ org: 'o', name: 'Bad', boardConfig: { hierarchy: 'sideways' } }),
    ).rejects.toThrow(/hierarchy/);
  });
});

describe('updateTeam board_config', () => {
  it('updates the column when a config is supplied', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 't1' }], null]); // existence check
    await updateTeam('t1', { boardConfig: { ringMode: 'jira' } });

    const update = mockExecute.mock.calls.find(c => /UPDATE teams SET/.test(c[0]));
    expect(update![0]).toContain('board_config');
    expect(JSON.parse(update![1][0]).ringMode).toBe('jira');
  });

  it('clears the column when boardConfig is null', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 't1' }], null]);
    await updateTeam('t1', { boardConfig: null });

    const update = mockExecute.mock.calls.find(c => /UPDATE teams SET/.test(c[0]));
    expect(update![0]).toContain('board_config = ?');
    expect(update![1][0]).toBeNull();
  });

  it('leaves the column alone when boardConfig is absent', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 't1' }], null]);
    await updateTeam('t1', { name: 'Renamed' });

    const update = mockExecute.mock.calls.find(c => /UPDATE teams SET/.test(c[0]));
    expect(update![0]).not.toContain('board_config');
  });
});
