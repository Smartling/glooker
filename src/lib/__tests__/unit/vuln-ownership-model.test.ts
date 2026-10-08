// src/lib/__tests__/unit/vuln-ownership-model.test.ts
// The ownership card's pure rules: hidden severity, header sorting, repository rows under Severity.
import {
  buildRepoView, deltaOpenFor, hasCarriedFootnote, nextSort, noOpenText, orderTeamRows, repoDisplay, repoTotals, sevShown, shownRepoSort, shownTeamSort, sortGlyph, teamRowsOverflow, teamRowsRoom,
  REPO_SORT_FIRST, TEAM_SORT_FIRST, type RepoSortKey, type SortState, type TeamSortKey,
} from '@/app/vulnerabilities/ownership-model';
import { OWNERSHIP_BODY_H, TEAM_FOOTNOTE_H, TEAM_HEAD_H, TEAM_ROW_H } from '@/app/vulnerabilities/dimensions';
import { cell, ovCell, ovDelta, ovDeltaTeam, ovNoBaseline, ovTeam, repoRow } from '../support/security-fixtures';

const names = (rows: Array<{ team: string }>) => rows.map(r => r.team);
const repoNames = (v: ReturnType<typeof buildRepoView>) => [...v.measured.map(d => d.row.fullName), ...v.unmeasured.map(r => r.fullName)];

describe('nextSort and sevShown', () => {
  it('a new key starts in its own direction; the same key flips', () => {
    expect(nextSort(null, 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(null, 'openCrit', 'desc')).toEqual({ key: 'openCrit', dir: 'desc' });
    expect(nextSort({ key: 'openCrit', dir: 'desc' }, 'openCrit', 'desc')).toEqual({ key: 'openCrit', dir: 'asc' });
    expect(nextSort({ key: 'openCrit', dir: 'asc' }, 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' });
  });

  // Revert: treat "both" as hiding something, or invert the test.
  it('Severity hides only the other severity', () => {
    expect(sevShown('both', 'critical') && sevShown('both', 'high')).toBe(true);
    expect([sevShown('critical', 'critical'), sevShown('critical', 'high')]).toEqual([true, false]);
    expect([sevShown('high', 'critical'), sevShown('high', 'high')]).toEqual([false, true]);
  });
});

describe('first sort directions (TEAM_SORT_FIRST, REPO_SORT_FIRST)', () => {
  // Revert: change any one value: this table names every key, so a key added without a decision here fails the completeness check.
  const TEAM: Record<TeamSortKey, SortState<string>['dir']> = {
    name: 'asc',
    cOpen: 'desc', cChange: 'desc', cResolved: 'desc', cPct: 'desc', cOverdue: 'desc',
    hOpen: 'desc', hChange: 'desc', hResolved: 'desc', hPct: 'desc', hOverdue: 'desc',
  };
  const REPO: Record<RepoSortKey, SortState<string>['dir']> = {
    name: 'asc', team: 'asc', next: 'asc', // names A-Z, and the soonest due date first
    openCrit: 'desc', overCrit: 'desc', openHigh: 'desc', overHigh: 'desc', oldest: 'desc', // numbers: the largest first
  };

  it.each(Object.entries(TEAM))('team table: %s starts %s', (key, dir) => {
    expect(TEAM_SORT_FIRST[key as TeamSortKey]).toBe(dir);
  });
  it.each(Object.entries(REPO))('repositories table: %s starts %s', (key, dir) => {
    expect(REPO_SORT_FIRST[key as RepoSortKey]).toBe(dir);
  });

  it('names no key the table above does not, and omits none', () => {
    expect(Object.keys(TEAM_SORT_FIRST).sort()).toEqual(Object.keys(TEAM).sort());
    expect(Object.keys(REPO_SORT_FIRST).sort()).toEqual(Object.keys(REPO).sort());
  });

  // The keys no other test sorts by: each is sorted in its FIRST direction and must put the expected row first.
  it('team columns Resolved, Change and % closed (the high ones too) put the largest first in their first direction', () => {
    const rows = [
      ovTeam('Alpha', ovCell(1, { resolved: 2 }), ovCell(1, { resolved: 9, pctClosed: 10 })),
      ovTeam('Beta', ovCell(1, { resolved: 8 }), ovCell(1, { resolved: 1, pctClosed: 90 })),
    ];
    const deltas = { critical: ovNoBaseline(), high: ovDelta(ovDeltaTeam('Total', 0), { teams: [ovDeltaTeam('Alpha', 7), ovDeltaTeam('Beta', -1)] }) };
    const first = (key: TeamSortKey) => names(orderTeamRows(rows, { key, dir: TEAM_SORT_FIRST[key] }, deltas, 'both'))[0];
    expect(first('cResolved')).toBe('Beta');
    expect(first('hResolved')).toBe('Alpha');
    expect(first('hChange')).toBe('Alpha');
    expect(first('hPct')).toBe('Beta');
  });

  it('repository columns Owning team and Next due start A-Z and soonest-first', () => {
    const rows = [
      repoRow('acme/a', 'Search', { critical: cell({ open: 1, nextDue: { date: '2026-10-09', daysRemaining: 9 } }) }),
      repoRow('acme/b', 'Payments', { critical: cell({ open: 1, nextDue: { date: '2026-10-02', daysRemaining: 2 } }) }),
    ];
    const first = (key: RepoSortKey) => repoNames(buildRepoView(rows, 'both', { key, dir: REPO_SORT_FIRST[key] }, ''))[0];
    expect(first('team')).toBe('acme/b'); // Payments before Search
    expect(first('next')).toBe('acme/b'); // Oct 2 before Oct 9
  });
});

describe('shownTeamSort and shownRepoSort (the server\'s order, drawn as a sort on Open)', () => {
  // Revert: return the raw sort (null), or ignore the severity.
  it('with no sort chosen, the Open column of the severity the tiles follow, descending', () => {
    expect(shownTeamSort(null, 'both')).toEqual({ key: 'cOpen', dir: 'desc' });
    expect(shownTeamSort(null, 'critical')).toEqual({ key: 'cOpen', dir: 'desc' });
    expect(shownTeamSort(null, 'high')).toEqual({ key: 'hOpen', dir: 'desc' });
    expect(shownRepoSort(null, 'both')).toEqual({ key: 'openCrit', dir: 'desc' });
    expect(shownRepoSort(null, 'high')).toEqual({ key: 'openHigh', dir: 'desc' });
  });

  it('a chosen sort is shown as it is; one on a hidden severity\'s column is not applied, so the default is shown', () => {
    const name: SortState<TeamSortKey> = { key: 'name', dir: 'asc' };
    expect(shownTeamSort(name, 'high')).toBe(name);
    expect(shownTeamSort({ key: 'cResolved', dir: 'asc' }, 'both')).toEqual({ key: 'cResolved', dir: 'asc' });
    expect(shownTeamSort({ key: 'cResolved', dir: 'asc' }, 'high')).toEqual({ key: 'hOpen', dir: 'desc' });
    expect(shownRepoSort({ key: 'overHigh', dir: 'asc' }, 'critical')).toEqual({ key: 'openCrit', dir: 'desc' });
    expect(shownRepoSort({ key: 'team', dir: 'asc' }, 'critical')).toEqual({ key: 'team', dir: 'asc' });
  });
});

describe('sortGlyph', () => {
  // Revert: drop the variation selector (macOS then paints ↕ as a blue emoji box).
  it('↕ as a text glyph when inactive, ↑ ascending, ↓ descending', () => {
    expect(sortGlyph(null)).toBe('↕\uFE0E');
    expect(sortGlyph({ key: 'name', dir: 'asc' })).toBe('↑');
    expect(sortGlyph({ key: 'name', dir: 'desc' })).toBe('↓');
  });
});

describe('deltaOpenFor', () => {
  it('reads a team, the Total row, and null for a team missing from an available delta or an unavailable delta', () => {
    const d = ovDelta(ovDeltaTeam('Total', 9), { teams: [ovDeltaTeam('Payments', 12)] });
    expect(deltaOpenFor(d, 'Payments')).toBe(12);
    expect(deltaOpenFor(d, 'Total')).toBe(9);
    expect(deltaOpenFor(d, 'Search')).toBeNull();
    expect(deltaOpenFor(ovNoBaseline(), 'Payments')).toBeNull();
    expect(deltaOpenFor(undefined, 'Payments')).toBeNull();
  });
});

describe('orderTeamRows', () => {
  const rows = [
    ovTeam('Alpha', ovCell(2, { resolved: 9, pctClosed: 80, overdue: 1 }), ovCell(7)),
    ovTeam('Beta', ovCell(5, { resolved: 1, pctClosed: 10, overdue: null }), ovCell(1)),
    ovTeam('Gamma', ovCell(5, { resolved: 4, pctClosed: null, overdue: 3 }), ovCell(4)),
  ];
  const deltas = { critical: ovDelta(ovDeltaTeam('Total', 0), { teams: [ovDeltaTeam('Alpha', -2), ovDeltaTeam('Beta', 4)] }), high: ovNoBaseline() };
  const order = (sort: SortState<TeamSortKey> | null, severity: 'both' | 'critical' | 'high' = 'both') => names(orderTeamRows(rows, sort, deltas, severity));

  it('with no active header it keeps the server order, and under "High only" orders by high open', () => {
    expect(order(null)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(order(null, 'high')).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  // Revert: ignore the direction, or break ties by something other than the name.
  it('sorts a column in either direction, ties by name', () => {
    expect(order({ key: 'cOpen', dir: 'desc' })).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(order({ key: 'cOpen', dir: 'asc' })).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(order({ key: 'name', dir: 'desc' })).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  // Revert: put nulls first when ascending.
  it('nulls (no overdue figure, no % closed, no delta) sort last in BOTH directions', () => {
    expect(order({ key: 'cOverdue', dir: 'desc' })).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(order({ key: 'cOverdue', dir: 'asc' })).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(order({ key: 'cPct', dir: 'asc' })).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(order({ key: 'cChange', dir: 'desc' })).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(order({ key: 'cChange', dir: 'asc' })).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  // Revert: sort by a hidden severity's column.
  it('a sort on a hidden severity\'s column is ignored (that column reads "–")', () => {
    expect(order({ key: 'hOpen', dir: 'desc' }, 'critical')).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(order({ key: 'hOpen', dir: 'desc' }, 'both')).toEqual(['Alpha', 'Gamma', 'Beta']);
  });
});

describe('repoDisplay', () => {
  const r = repoRow('acme/checkout-api', 'Payments', {
    critical: cell({ open: 3, overdue: 1, dueSoon: 0, oldestOpenDays: 20, nextDue: { date: '2026-10-05', daysRemaining: 5 } }),
    high: cell({ open: 4, overdue: 2, dueSoon: 1, oldestOpenDays: 90, nextDue: { date: '2026-10-02', daysRemaining: 2 } }),
  });

  it('combines the shown severities: open sum, oldest = max, next due = earliest', () => {
    const d = repoDisplay(r, 'both');
    expect([d.open, d.oldest, d.next]).toEqual([7, 90, { date: '2026-10-02', daysRemaining: 2 }]);
  });

  // Revert: ignore Severity in the combination.
  it('leaves a hidden severity out of the combination', () => {
    expect(repoDisplay(r, 'critical')).toMatchObject({ open: 3, oldest: 20, next: { date: '2026-10-05', daysRemaining: 5 } });
    expect(repoDisplay(r, 'high')).toMatchObject({ open: 4, oldest: 90, next: { date: '2026-10-02', daysRemaining: 2 } });
  });

  it('a repository with nothing open has no oldest and no next due', () => {
    expect(repoDisplay(repoRow('acme/quiet', 'Search'), 'both')).toMatchObject({ open: 0, oldest: null, next: null, overCrit: null });
  });
});

describe('buildRepoView', () => {
  const rows = [
    repoRow('acme/a-api', 'Payments', { critical: cell({ open: 1, overdue: 0, oldestOpenDays: 5 }), high: cell({ open: 9, overdue: 2, oldestOpenDays: 50 }) }),
    repoRow('acme/b-web', 'Search', { critical: cell({ open: 4, overdue: 1, oldestOpenDays: 30 }), high: cell({ open: 0, overdue: 0 }) }),
    repoRow('acme/c-batch', 'Platform', { critical: cell({ open: 4, overdue: 3, oldestOpenDays: null }), high: cell({ open: 2, overdue: 0 }) }),
    repoRow('acme/z-quiet', 'Payments'),
    repoRow('acme/legacy', 'Platform', { critical: cell({ open: 8 }), unmeasured: { status: 'dependabot-off', detail: null } }),
    repoRow('acme/ancient', 'Platform', { critical: cell({ open: 2 }), unmeasured: { status: 'error', detail: 'HTTP 500' } }),
  ];
  const view = (sort: SortState<RepoSortKey> | null, severity: 'both' | 'critical' | 'high' = 'both', q = '') => buildRepoView(rows, severity, sort, q);

  it('default order is the server order (critical open, high open, name), unmeasured last by name', () => {
    expect(repoNames(view(null))).toEqual(['acme/c-batch', 'acme/b-web', 'acme/a-api', 'acme/z-quiet', 'acme/ancient', 'acme/legacy']);
  });

  // Revert: order by the hidden severity.
  it('a single shown severity orders by that severity alone', () => {
    expect(repoNames(view(null, 'high'))).toEqual(['acme/a-api', 'acme/c-batch', 'acme/b-web', 'acme/z-quiet', 'acme/ancient', 'acme/legacy']);
    expect(repoNames(view(null, 'critical'))).toEqual(['acme/b-web', 'acme/c-batch', 'acme/a-api', 'acme/z-quiet', 'acme/ancient', 'acme/legacy']);
  });

  // Revert: sort the unmeasured rows with the rest, or put them first when descending.
  it('unmeasured rows ignore sorting and stay last in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const out = repoNames(view({ key: 'openCrit', dir }));
      expect(out.slice(-2)).toEqual(['acme/ancient', 'acme/legacy']);
    }
    expect(repoNames(view({ key: 'name', dir: 'desc' }))).toEqual(['acme/z-quiet', 'acme/c-batch', 'acme/b-web', 'acme/a-api', 'acme/ancient', 'acme/legacy']);
  });

  it('sorts a numeric column, ties by name, with nulls last in both directions', () => {
    expect(repoNames(view({ key: 'oldest', dir: 'desc' })).slice(0, 4)).toEqual(['acme/a-api', 'acme/b-web', 'acme/c-batch', 'acme/z-quiet']);
    expect(repoNames(view({ key: 'oldest', dir: 'asc' })).slice(0, 4)).toEqual(['acme/b-web', 'acme/a-api', 'acme/c-batch', 'acme/z-quiet']);
    expect(repoNames(view({ key: 'overCrit', dir: 'desc' })).slice(0, 3)).toEqual(['acme/c-batch', 'acme/b-web', 'acme/a-api']);
  });

  // Revert: honour a sort on a hidden severity's column.
  it('a sort on a hidden severity\'s column is ignored', () => {
    expect(repoNames(view({ key: 'openHigh', dir: 'desc' }, 'critical'))).toEqual(repoNames(view(null, 'critical')));
  });

  it('the name filter is case-insensitive and applies to measured and unmeasured rows', () => {
    expect(repoNames(view(null, 'both', ' LEGA'))).toEqual(['acme/legacy']);
    expect(repoNames(view(null, 'both', 'b-'))).toEqual(['acme/b-web']);
    expect(repoNames(view(null, 'both', 'nothing-matches'))).toEqual([]);
  });
});

describe('repoTotals', () => {
  const rows = [
    repoRow('acme/a', 'Payments', { critical: cell({ open: 3, overdue: 1, oldestOpenDays: 10, nextDue: { date: '2026-10-09', daysRemaining: 9 } }), high: cell({ open: 1, overdue: null }) }),
    repoRow('acme/b', 'Payments', { critical: cell({ open: 2, overdue: 0, oldestOpenDays: 40 }), high: cell({ open: 0, overdue: null }) }),
    repoRow('acme/c', 'Payments', { critical: cell({ open: 50, overdue: 50 }), unmeasured: { status: 'error', detail: null } }),
  ];

  // Revert: drop the `unmeasured = []` default, or sum rows other than the ones passed.
  it('with only the measured rows passed, it sums those rows', () => {
    const t = repoTotals(buildRepoView(rows, 'both', null, '').measured);
    expect(t).toMatchObject({ count: 2, openCrit: 5, openHigh: 1, overCrit: 1, oldest: 40, next: { date: '2026-10-09', daysRemaining: 9 } });
  });

  // Revert: sum only the measured rows (the footer then disagrees with the team table and the strip).
  it('with the unmeasured rows passed too, open and overdue include their stored counts; count, oldest and next due do not', () => {
    const v = buildRepoView(rows, 'both', null, '');
    const t = repoTotals(v.measured, v.unmeasured.map(r => repoDisplay(r, 'both')));
    expect(t).toMatchObject({ count: 2, openCrit: 55, openHigh: 1, overCrit: 51, oldest: 40, next: { date: '2026-10-09', daysRemaining: 9 } });
  });

  it('an inactive SLA keeps overdue null rather than summing nulls to zero', () => {
    expect(repoTotals(buildRepoView(rows, 'both', null, '').measured).overHigh).toBeNull();
  });

  // Revert: derive the high figures from the critical ones, or null one severity's overdue because the other's is null.
  it('each severity is summed on its own: an inactive critical SLA leaves overCrit null while overHigh is still summed, and the other way round', () => {
    const mixed = (crit: number | null, high: number | null) => [
      repoRow('acme/a', 'Payments', { critical: cell({ open: 2, overdue: crit }), high: cell({ open: 1, overdue: high }) }),
      repoRow('acme/b', 'Payments', { critical: cell({ open: 3, overdue: crit }), high: cell({ open: 4, overdue: high }) }),
    ];
    const totals = (rs: ReturnType<typeof mixed>) => { const v = buildRepoView(rs, 'both', null, ''); return repoTotals(v.measured, v.unmeasured.map(r => repoDisplay(r, 'both'))); };
    expect(totals(mixed(null, 2))).toMatchObject({ openCrit: 5, openHigh: 5, overCrit: null, overHigh: 4 });
    expect(totals(mixed(1, null))).toMatchObject({ openCrit: 5, openHigh: 5, overCrit: 2, overHigh: null });
  });

  it('a hidden severity does not change the other severity\'s totals (Severity only decides what the footer shows)', () => {
    const v = (sev: 'both' | 'critical' | 'high') => buildRepoView(rows, sev, null, '').measured;
    const both = repoTotals(v('both'));
    for (const sev of ['critical', 'high'] as const) {
      const t = repoTotals(v(sev));
      expect([t.openCrit, t.openHigh, t.overCrit, t.overHigh]).toEqual([both.openCrit, both.openHigh, both.overCrit, both.overHigh]);
    }
  });

  it('no rows: zero count, nothing oldest, nothing due', () => {
    expect(repoTotals([])).toEqual({ count: 0, openCrit: 0, openHigh: 0, overCrit: null, overHigh: null, oldest: null, next: null });
  });
});

describe('noOpenText', () => {
  // Revert: always say "no open alerts" (a repository with only high alerts reads clean under "Critical only").
  it('says "no open alerts", or names the severity when Severity narrows the view', () => {
    expect(noOpenText('both')).toBe('no open alerts');
    expect(noOpenText('critical')).toBe('no open critical alerts');
    expect(noOpenText('high')).toBe('no open high alerts');
  });
});

describe('hasCarriedFootnote', () => {
  const total = (resolved: number | null, carried: number) => ({ pivot: { total: ovTeam('Total', ovCell(5, { resolved, carriedResolved: carried }), ovCell(0)) } });

  // Revert: drop a clause: the footnote would show without carried history, with an untrusted resolved count, or under "High only".
  it('is true only with carried history in a trusted critical Resolved count while the critical column is shown', () => {
    expect(hasCarriedFootnote(total(8, 3), 'both')).toBe(true);
    expect(hasCarriedFootnote(total(8, 3), 'critical')).toBe(true);
    expect(hasCarriedFootnote(total(8, 0), 'both')).toBe(false);
    expect(hasCarriedFootnote(total(null, 3), 'both')).toBe(false);
    expect(hasCarriedFootnote(total(8, 3), 'high')).toBe(false);
  });
});

describe('teamRowsOverflow', () => {
  // The rows' room is the card body minus the pinned header and the pinned Total row (and the † footnote under it).
  const room = OWNERSHIP_BODY_H - TEAM_HEAD_H - TEAM_ROW_H;
  const fit = Math.floor(room / TEAM_ROW_H);

  // Revert: count the footnote's height as zero, or forget the Total row's.
  it('is false while every row fits and true from the first row that does not', () => {
    expect(teamRowsOverflow(0, false)).toBe(false);
    expect(teamRowsOverflow(fit, false)).toBe(false);
    expect(teamRowsOverflow(fit + 1, false)).toBe(true);
    expect(teamRowsOverflow(14, false)).toBe(true);
  });

  // Revert: stop subtracting TEAM_FOOTNOTE_H when there is a footnote. The row COUNT that fits can be the same with and
  // without it at today's constants, so the test pins the room in pixels.
  it('the † footnote under the Total row takes TEAM_FOOTNOTE_H of room from the rows', () => {
    expect(teamRowsRoom(false)).toBe(room);
    expect(teamRowsRoom(true)).toBe(room - TEAM_FOOTNOTE_H);
    const fitWith = Math.floor(teamRowsRoom(true) / TEAM_ROW_H);
    expect(teamRowsOverflow(fitWith, true)).toBe(false);
    expect(teamRowsOverflow(fitWith + 1, true)).toBe(true);
  });

  it('four teams fit the 330px body (the design\'s four-team organisation never scrolls)', () => {
    expect(teamRowsOverflow(4, false)).toBe(false);
    expect(teamRowsOverflow(4, true)).toBe(false);
    expect(teamRowsOverflow(5, false)).toBe(true);
  });
});
