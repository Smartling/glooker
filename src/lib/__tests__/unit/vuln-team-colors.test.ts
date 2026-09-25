import { assignTeamColors, OTHER_TEAM_COLOR } from '@/app/vulnerabilities/team-colors';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

const s = (team: string, open: number): TrendSeries => ({ team, points: [{ date: '2026-09-01', open: 1 }, { date: '2026-09-08', open }] });

it('assigns palette slots by sorted team name, not by rank', () => {
  expect(assignTeamColors([s('TeamC', 50), s('TeamA', 1), s('TeamB', 9)])).toEqual({
    TeamA: 'var(--vuln-series-1)',
    TeamB: 'var(--vuln-series-2)',
    TeamC: 'var(--vuln-series-3)',
  });
});

it('a team keeps its colour when the open-count ranking swaps', () => {
  const before = assignTeamColors([s('TeamA', 10), s('TeamB', 2)]);
  const after = assignTeamColors([s('TeamA', 2), s('TeamB', 10)]);
  expect(after).toEqual(before);
});

it('gives every team a distinct colour up to 12 teams', () => {
  const teams = Array.from({ length: 12 }, (_, i) => s(`Team${String(i).padStart(2, '0')}`, i));
  const colors = Object.values(assignTeamColors(teams));
  expect(new Set(colors).size).toBe(12);
});

it('beyond 12 teams: the 12 with the most open alerts (ties by name) get slots, the rest share "other"', () => {
  const teams = [
    ...Array.from({ length: 12 }, (_, i) => s(`Busy${String(i).padStart(2, '0')}`, 100 + i)),
    s('Quiet-b', 1),
    s('Quiet-a', 1),
  ];
  const colors = assignTeamColors(teams);
  expect(colors['Quiet-a']).toBe(OTHER_TEAM_COLOR);
  expect(colors['Quiet-b']).toBe(OTHER_TEAM_COLOR);
  expect(colors.Busy00).toBe('var(--vuln-series-1)');
  expect(colors.Busy11).toBe('var(--vuln-series-12)');
});

it('breaks an open-count tie at the 12-team boundary by name', () => {
  const teams = [...Array.from({ length: 11 }, (_, i) => s(`Busy${String(i).padStart(2, '0')}`, 100)), s('Tie-b', 5), s('Tie-a', 5)];
  const colors = assignTeamColors(teams);
  expect(colors['Tie-a']).not.toBe(OTHER_TEAM_COLOR);
  expect(colors['Tie-b']).toBe(OTHER_TEAM_COLOR);
});

it('returns an empty map for no series and tolerates string counts', () => {
  expect(assignTeamColors([])).toEqual({});
  const colors = assignTeamColors([{ team: 'TeamA', points: [{ date: '2026-09-01', open: '3' as unknown as number }] }]);
  expect(colors.TeamA).toBe('var(--vuln-series-1)');
});
