/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-hooks.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useSecurityUrl, useAlertList, type SeverityFilter } from '@/app/vulnerabilities/security-state';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;
const params = (url: string) => new URL(url, 'http://x').searchParams;

beforeEach(() => { nav().__resetSearch(''); });

describe('useSecurityUrl: reading', () => {
  it('reads defaults from an empty URL', () => {
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current).toMatchObject({
      view: 'overview', own: 'teams', codebase: 'backend', team: null, repo: null,
      severity: 'both', baseline: 'last', range: 'all', kSev: 'critical',
    });
    expect(result.current.isDefault).toEqual({ codebase: true, team: true, severity: true, baseline: true, repo: true, all: true });
  });

  it('kSev follows Severity: high only gives high; the retired ?sev= key is ignored', () => {
    nav().__resetSearch('severity=high');
    expect(renderHook(() => useSecurityUrl()).result.current.kSev).toBe('high');
    nav().__resetSearch('sev=high');
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current.severity).toBe('both');
    expect(result.current.kSev).toBe('critical');
  });

  it('a hand-edited baseline the API would reject reads as last', () => {
    nav().__resetSearch('baseline=garbage');
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current.baseline).toBe('last');
    expect(result.current.isDefault.baseline).toBe(true);
  });

  it('isDefault.all is false when the repository alone is set (Reset filters clears it)', () => {
    nav().__resetSearch('repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current.isDefault.repo).toBe(false);
    expect(result.current.isDefault.all).toBe(false);
  });
});

describe('useSecurityUrl: clearing handlers write ONE URL', () => {
  it('setCodebase writes the codebase and clears repo in the same replace, with scroll:false', () => {
    nav().__resetSearch('repo=acme%2Fledger&team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setCodebase('frontend'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    expect(calls[0].opts).toEqual({ scroll: false });
    const p = params(calls[0].url);
    expect(p.get('codebase')).toBe('frontend');
    expect(p.has('repo')).toBe(false);
    expect(p.get('team')).toBe('Payments');
  });

  it('setTeam writes the team and clears repo in the same replace', () => {
    nav().__resetSearch('repo=acme%2Fledger&team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setTeam('Search'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    const p = params(calls[0].url);
    expect(p.get('team')).toBe('Search');
    expect(p.has('repo')).toBe(false);
  });

  it('setTeam(null) removes the team key', () => {
    nav().__resetSearch('team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setTeam(null));
    expect(params(nav().__calls[0].url).has('team')).toBe(false);
  });

  it('clearRepo removes only the repo', () => {
    nav().__resetSearch('repo=acme%2Fledger&team=Payments&view=alerts');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.clearRepo());
    const p = params(nav().__calls[0].url);
    expect(p.has('repo')).toBe(false);
    expect(p.get('team')).toBe('Payments');
    expect(p.get('view')).toBe('alerts');
  });
});

describe('useSecurityUrl: row selection and history', () => {
  it('selectTeamRow sets the team and own=repos in ONE push, clears the repo and never touches the view', () => {
    nav().__resetSearch('repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectTeamRow('Payments'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('push');
    expect(calls[0].opts).toEqual({ scroll: false });
    const p = params(calls[0].url);
    expect(p.get('team')).toBe('Payments');
    expect(p.get('own')).toBe('repos');
    expect(p.has('view')).toBe(false);
    expect(p.has('repo')).toBe(false);
  });

  it('selecting the selected team again clears it with a replace and leaves the ownership tab alone', () => {
    nav().__resetSearch('team=Payments&own=repos');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectTeamRow('Payments'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    const p = params(calls[0].url);
    expect(p.has('team')).toBe(false);
    expect(p.get('own')).toBe('repos');
  });

  it('selectRepoRow is one push: view=alerts, the repository and ITS team (the team write must not clear the repo)', () => {
    nav().__resetSearch('team=Payments&repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectRepoRow({ fullName: 'acme/search-index', team: 'Search' }));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('push');
    const p = params(calls[0].url);
    expect(p.get('view')).toBe('alerts');
    expect(p.get('team')).toBe('Search');
    expect(p.get('repo')).toBe('acme/search-index');
  });

  it('setRepo (a rail row inside the Alerts view) writes only repo, as a replace: no history entry, view and team untouched', () => {
    nav().__resetSearch('view=alerts&team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setRepo('acme/ledger'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    expect(calls[0].opts).toEqual({ scroll: false });
    const p = params(calls[0].url);
    expect(p.get('repo')).toBe('acme/ledger');
    expect(p.get('view')).toBe('alerts');
    expect(p.get('team')).toBe('Payments');
  });

  it('selectRepoRow accepts Unassigned as a team', () => {
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectRepoRow({ fullName: 'acme/orphan', team: 'Unassigned' }));
    expect(params(nav().__calls[0].url).get('team')).toBe('Unassigned');
  });

  it('setView and setOwn push; the other setters replace', () => {
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setView('alerts'));
    expect(nav().__calls[0].kind).toBe('push');
    act(() => result.current.setOwn('repos'));
    expect(nav().__calls[1].kind).toBe('push');
    act(() => result.current.setSeverity('high'));
    expect(nav().__calls[2].kind).toBe('replace');
    act(() => result.current.setBaseline('7d'));
    expect(nav().__calls[3].kind).toBe('replace');
    act(() => result.current.setRange('90d'));
    expect(nav().__calls[4].kind).toBe('replace');
    for (const c of nav().__calls) expect(c.opts).toEqual({ scroll: false });
  });

  it('resetFilters clears the five filters in one replace and never changes the view, ownership tab or range', () => {
    nav().__resetSearch('view=alerts&own=repos&range=1y&codebase=frontend&team=Payments&severity=high&baseline=7d&repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.resetFilters());
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    expect(Object.fromEntries(params(calls[0].url).entries())).toEqual({ view: 'alerts', own: 'repos', range: '1y' });
  });
});

describe('useAlertList', () => {
  const scope: { codebase: CodebaseGroup; team: string | null; repo: string | null; severity: SeverityFilter } =
    { codebase: 'backend', team: null, repo: null, severity: 'both' };

  it('starts on the first page of open alerts with no filters', () => {
    const { result } = renderHook(() => useAlertList(scope));
    expect(result.current.list).toEqual({ status: 'open', overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', sort: null, page: 1 });
  });

  it('Resolved clears both time toggles; Overdue and Due ≤ 7d switch each other off', () => {
    const { result } = renderHook(() => useAlertList(scope));
    act(() => result.current.toggleOverdue());
    expect(result.current.list).toMatchObject({ overdue: true, dueSoon: false });
    act(() => result.current.toggleDueSoon());
    expect(result.current.list).toMatchObject({ overdue: false, dueSoon: true });
    act(() => result.current.toggleOverdue());
    expect(result.current.list).toMatchObject({ overdue: true, dueSoon: false });
    act(() => result.current.setStatus('resolved'));
    expect(result.current.list).toMatchObject({ status: 'resolved', overdue: false, dueSoon: false });
  });

  it('a header starts in its own first direction (Age descending, the rest ascending), clicking it again reverses, a new key starts in its own first direction', () => {
    const { result } = renderHook(() => useAlertList(scope));
    expect(result.current.list.sort).toBeNull();   // no header active: the server's default order
    act(() => result.current.setSort('age'));
    expect(result.current.list.sort).toEqual({ key: 'age', dir: 'desc' });
    act(() => result.current.setSort('age'));
    expect(result.current.list.sort).toEqual({ key: 'age', dir: 'asc' });
    act(() => result.current.setSort('due'));
    expect(result.current.list.sort).toEqual({ key: 'due', dir: 'asc' });   // a header was active (Age), so Due starts in its own direction
    act(() => result.current.setSort('age'));
    expect(result.current.list.sort).toEqual({ key: 'age', dir: 'desc' });   // back to Age: first direction again, not the old one
  });

  it.each([['severity', 'asc'], ['advisory', 'asc'], ['repo', 'asc'], ['age', 'desc'], ['state', 'asc']] as const)(
    'the first click on %s sorts %s', (key, dir) => {
      const { result } = renderHook(() => useAlertList(scope));
      act(() => result.current.setSort(key));
      expect(result.current.list.sort).toEqual({ key, dir });
    });

  // Revert: drop the `s.sort === null && key === 'due'` case in setSort. The list draws "Due ↑" while no header is chosen, so a
  // first click that sorted ascending would change nothing visible.
  it('with no header chosen the list is drawn as Due ascending, so the first click on Due sorts descending; the next click flips it', () => {
    const { result } = renderHook(() => useAlertList(scope));
    expect(result.current.list.sort).toBeNull();
    act(() => result.current.setSort('due'));
    expect(result.current.list.sort).toEqual({ key: 'due', dir: 'desc' });
    act(() => result.current.setSort('due'));
    expect(result.current.list.sort).toEqual({ key: 'due', dir: 'asc' });
  });

  it('every list-filter setter resets the page to 1; setPage does not', () => {
    const { result } = renderHook(() => useAlertList(scope));
    const calls: Array<[string, () => void]> = [
      ['setStatus', () => result.current.setStatus('all')],
      ['toggleOverdue', () => result.current.toggleOverdue()],
      ['toggleDueSoon', () => result.current.toggleDueSoon()],
      ['toggleReopened', () => result.current.toggleReopened()],
      ['toggleRuntimeOnly', () => result.current.toggleRuntimeOnly()],
      ['setQuery', () => result.current.setQuery('lodash')],
      ['setSort', () => result.current.setSort('repo')],
    ];
    for (const [name, call] of calls) {
      act(() => result.current.setPage(4));
      expect(result.current.list.page).toBe(4);
      act(() => call());
      expect([name, result.current.list.page]).toEqual([name, 1]);
    }
  });

  it('a scope change resets the page in the SAME render: no render ever pairs the new scope with the old page', () => {
    const seen: Array<[string | null, number]> = [];
    const { result, rerender } = renderHook(p => {
      const c = useAlertList(p);
      seen.push([p.team, c.list.page]);
      return c;
    }, { initialProps: scope });
    act(() => result.current.setPage(3));
    expect(result.current.list.page).toBe(3);

    seen.length = 0;
    rerender({ ...scope, team: 'Search' });
    expect(result.current.list.page).toBe(1);
    expect(seen.filter(([team, page]) => team === 'Search' && page !== 1)).toEqual([]);
  });

  it.each([
    ['codebase', { ...scope, codebase: 'frontend' as const }],
    ['repo', { ...scope, repo: 'acme/ledger' }],
    ['severity', { ...scope, severity: 'high' as const }],
  ])('a %s change also resets the page', (_name, next) => {
    const { result, rerender } = renderHook(p => useAlertList(p), { initialProps: scope });
    act(() => result.current.setPage(3));
    rerender(next);
    expect(result.current.list.page).toBe(1);
  });
});
