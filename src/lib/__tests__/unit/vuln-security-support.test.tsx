/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-support.test.tsx
// The support modules are test infrastructure, but every URL-state test in Waves 2 to 4 trusts
// them, so their own behaviour is pinned here: a mock that silently dropped the options argument
// or the push/replace distinction would make those tests pass for the wrong reason.
import { renderHook, act } from '@testing-library/react';
import { createNavigationMock } from '../support/security-nav-mock';
import { fetchRouter, callsTo, REPO_ROWS, summaryFixture, slot } from '../support/security-fixtures';

describe('createNavigationMock', () => {
  it('records push and replace with their options and re-renders subscribers with the new search', () => {
    const nav = createNavigationMock('a=1');
    const { result } = renderHook(() => ({ router: nav.useRouter(), params: nav.useSearchParams() }));
    expect(result.current.params.get('a')).toBe('1');

    act(() => result.current.router.push('/vulnerabilities?view=alerts', { scroll: false }));
    expect(nav.__calls).toEqual([{ kind: 'push', url: '/vulnerabilities?view=alerts', opts: { scroll: false } }]);
    expect(result.current.params.get('view')).toBe('alerts');

    act(() => result.current.router.replace('/vulnerabilities'));
    expect(nav.__calls[1]).toEqual({ kind: 'replace', url: '/vulnerabilities', opts: undefined });
    expect(result.current.params.has('view')).toBe(false);
  });

  it('router and params keep their identity across a re-render with no navigation, and params changes identity after a push', () => {
    const nav = createNavigationMock('a=1');
    const { result, rerender } = renderHook(() => ({ router: nav.useRouter(), params: nav.useSearchParams() }));
    const first = result.current;
    rerender();
    expect(result.current.router).toBe(first.router);
    expect(result.current.router.push).toBe(first.router.push);
    expect(result.current.params).toBe(first.params);

    act(() => result.current.router.push('/vulnerabilities?a=2'));
    expect(result.current.router).toBe(first.router);
    expect(result.current.params).not.toBe(first.params);
    expect(result.current.params.get('a')).toBe('2');
  });

  it('__resetSearch sets the search and clears the recorded calls', () => {
    const nav = createNavigationMock();
    const { result } = renderHook(() => nav.useSearchParams());
    act(() => nav.useRouter().push('/vulnerabilities?x=1'));
    expect(nav.__calls).toHaveLength(1);
    act(() => nav.__resetSearch('team=Payments'));
    expect(nav.__calls).toHaveLength(0);
    expect(result.current.get('team')).toBe('Payments');
  });
});

describe('fetchRouter', () => {
  it('answers by route name, echoes the applied filters from the URL, and honours a status', async () => {
    const f = fetchRouter({ alerts: { status: 400, body: { error: 'unknown repo' } } });

    const ok = await f('/api/vulnerabilities/repos?codebase=frontend&team=Search');
    expect(ok.ok).toBe(true);
    const body = await ok.json();
    expect(body.appliedFilters).toEqual({ codebase: 'frontend', team: 'Search' });
    expect(body.rows).toHaveLength(REPO_ROWS.length);

    const bad = await f('/api/vulnerabilities/alerts?codebase=backend');
    expect([bad.ok, bad.status]).toEqual([false, 400]);
    expect(await bad.json()).toEqual({ error: 'unknown repo' });

    expect(callsTo(f, 'repos')).toHaveLength(1);
    expect(callsTo(f, 'alerts')[0].searchParams.get('codebase')).toBe('backend');
  });

  it('a route may be a function of the URL (and async)', async () => {
    const f = fetchRouter({ summary: async url => ({ body: { team: url.searchParams.get('team') } }) });
    const res = await f('/api/vulnerabilities/summary?team=Search');
    expect(await res.json()).toEqual({ team: 'Search' });
  });

  it('the alerts and trend routes echo the request as realistic appliedFilters (camelCase keys, numeric limit and offset, boolean flags)', async () => {
    const f = fetchRouter();
    const alerts = await (await f('/api/vulnerabilities/alerts?codebase=frontend&state=all&limit=10&offset=20&sort=due:asc&due_soon=true')).json();
    expect(alerts.appliedFilters).toEqual({ codebase: 'frontend', state: 'all', limit: 10, offset: 20, sort: 'due:asc', dueSoon: true });
    const trend = await (await f('/api/vulnerabilities/trend?codebase=shared&severity=high&since=2026-06-25')).json();
    expect(trend.appliedFilters).toEqual({ codebase: 'shared', severity: 'high', since: '2026-06-25' });
  });

  it('alerts echo: a request with no codebase or state gets the server defaults', async () => {
    const alerts = await (await fetchRouter()('/api/vulnerabilities/alerts')).json();
    expect(alerts.appliedFilters).toEqual({ codebase: 'backend', state: 'open' });
  });

  it('alerts echo: snake_case request names come back camelCase, baseline and since are not echoed, false booleans are kept', async () => {
    const f = fetchRouter();
    const a = await (await f('/api/vulnerabilities/alerts?due_before=2026-10-01&overdue=false&package=lodash&created_since=2026-09-01&resolved_since=2026-09-02&dependency_scope=runtime&baseline=7d&since=2026-06-01')).json();
    expect(a.appliedFilters).toEqual({
      codebase: 'backend', state: 'open', dueBefore: '2026-10-01', overdue: false, packageName: 'lodash',
      createdSince: '2026-09-01', resolvedSince: '2026-09-02', dependencyScope: 'runtime',
    });
  });

  it('alerts echo: a request the real parser rejects is answered 400, as the route would', async () => {
    const res = await fetchRouter()('/api/vulnerabilities/alerts?overdue=yes');
    expect([res.ok, res.status]).toEqual([false, 400]);
    expect(await res.json()).toEqual({ error: 'overdue must be true, false, 1 or 0' });
  });

  it('trend echo includes team, and severity defaults to critical', async () => {
    const t = await (await fetchRouter()('/api/vulnerabilities/trend?team=Payments')).json();
    expect(t.appliedFilters).toEqual({ codebase: 'backend', team: 'Payments', severity: 'critical' });
  });

  it('an undefined route entry falls back to the default', async () => {
    const res = await fetchRouter({ repos: undefined })('/api/vulnerabilities/repos');
    expect((await res.json()).rows).toHaveLength(REPO_ROWS.length);
  });
});

describe('typed builders', () => {
  it('summaryFixture is a healthy payload; a delta with no baseline has the exact "unavailable" shape the caption code reads', () => {
    const s = summaryFixture();
    expect(s.delta.critical).toEqual({ available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null });
    expect(s.pivot.total.critical.open).toBe(10);
    expect(summaryFixture({ org: 'other' }).org).toBe('other');
    expect(summaryFixture({ org: 'other' }).knownTeams).toEqual(s.knownTeams);
  });

  it('slot(): data in hand is neither loading nor stale; no data is loading unless overridden', () => {
    expect(slot('x')).toMatchObject({ data: 'x', loading: false, stale: false, errorText: null });
    expect(slot<string>(undefined)).toMatchObject({ data: undefined, loading: true });
    expect(slot<string>(undefined, { loading: false, errorText: 'boom' })).toMatchObject({ loading: false, errorText: 'boom' });
  });
});
