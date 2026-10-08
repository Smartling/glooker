/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-use-security-data.test.tsx
// Real SWR against a routed fetch mock: the assertions are on the requests the page would make.
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { useSWRConfig, type SWRConfiguration } from 'swr';
import {
  useSecurityUrl, useAlertList, sparklineSince, trendSince,
  type SecurityUrl, type AlertListController,
} from '@/app/vulnerabilities/security-state';
import { useSecurityData, type SecurityData } from '@/app/vulnerabilities/use-security-data';
import { SwrFresh, fetchRouter, callsTo, summaryFixture, reposFixture, alertsFixture, alertRow, syncInfo, REPO_ROWS } from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;

const renders: SecurityData[] = [];   // every render's data, so a state that lasts one render is still seen
let latest: { url: SecurityUrl; list: AlertListController; data: SecurityData; mutate: ReturnType<typeof useSWRConfig>['mutate'] };
function Probe() {
  const url = useSecurityUrl();
  const list = useAlertList({ codebase: url.codebase, team: url.team, repo: url.repo, severity: url.severity });
  const data = useSecurityData(url, list.list);
  const { mutate } = useSWRConfig();
  latest = { url, list, data, mutate };
  renders.push(data);
  return null;
}

function mount(search = '', routes: Parameters<typeof fetchRouter>[0] = {}, swr?: SWRConfiguration) {
  renders.length = 0;
  nav().__resetSearch(search);
  const fetchMock = fetchRouter(routes);
  (global as any).fetch = fetchMock;
  render(<SwrFresh config={swr}><Probe /></SwrFresh>);
  return fetchMock;
}

/** The settings the app's SWRProvider applies (src/lib/swr-provider.tsx), which SwrFresh otherwise turns off. */
const PRODUCTION_SWR: SWRConfiguration = { dedupingInterval: 60_000, errorRetryCount: 1 };

const allLoaded = () => waitFor(() => {
  const d = latest.data;
  expect(d.summary.data && d.repos.data && d.coverage.data && d.trend.data && d.sparkline.data && d.alerts.data).toBeTruthy();
});
const searches = (f: jest.Mock, name: Parameters<typeof callsTo>[1]) => callsTo(f, name).map(u => u.search);

describe('keys (the spec data-flow table)', () => {
  it('default scope: one summary request (the two summary keys dedupe), coverage and repos by codebase, two trend requests, first alerts page', async () => {
    const f = mount('');
    await allLoaded();
    expect(searches(f, 'summary')).toEqual(['?codebase=backend&baseline=last']);
    expect(searches(f, 'coverage')).toEqual(['?codebase=backend']);
    // The header's meta line asks for the same rows (codebase only), and with no team that is the same URL: one request.
    expect(searches(f, 'repos')).toEqual(['?codebase=backend']);
    expect(latest.data.keys.metaRepos).toBe(latest.data.keys.repos);
    expect(searches(f, 'trend').sort()).toEqual([
      '?codebase=backend&severity=critical',
      `?codebase=backend&severity=critical&since=${sparklineSince(new Date())}`,
    ].sort());
    expect(searches(f, 'alerts')).toEqual(['?codebase=backend&state=open&limit=10&offset=0']);
  });

  it('with a team: summary, coverage, repos and alerts carry it; the team table summary, the header meta rows, trend and sparkline never do', async () => {
    const f = mount('team=Payments');
    await allLoaded();
    expect(searches(f, 'summary').sort()).toEqual([
      '?codebase=backend&baseline=last',
      '?codebase=backend&baseline=last&team=Payments',
    ]);
    expect(searches(f, 'coverage')).toEqual(['?codebase=backend&team=Payments']);
    // Two repos requests: the scoped one, and the codebase-only one the header meta line counts its repositories and owning teams from.
    expect(searches(f, 'repos').sort()).toEqual(['?codebase=backend', '?codebase=backend&team=Payments']);
    expect(latest.data.keys.metaRepos).toMatch(/\/repos\?codebase=backend$/);
    expect(latest.data.keys.repos).toMatch(/\/repos\?codebase=backend&team=Payments$/);
    expect(latest.data.metaRepos.data?.appliedFilters).toEqual({ codebase: 'backend' });
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.has('team')).toBe(false);
    expect(callsTo(f, 'alerts')[0].searchParams.get('team')).toBe('Payments');
  });

  it('Severity "both" sends no severity to the alert list and never sends the text "both" anywhere; trend and sparkline use critical', async () => {
    const f = mount('');
    await allLoaded();
    expect(callsTo(f, 'alerts')[0].searchParams.has('severity')).toBe(false);
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.get('severity')).toBe('critical');
    for (const [url] of f.mock.calls) expect(String(url)).not.toContain('severity=both');
  });

  it('High only: the alert list, trend and sparkline all use high', async () => {
    const f = mount('severity=high');
    await allLoaded();
    expect(callsTo(f, 'alerts')[0].searchParams.get('severity')).toBe('high');
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.get('severity')).toBe('high');
  });

  it('the old ?sev=high key is ignored: critical everywhere, no severity on the list', async () => {
    const f = mount('sev=high');
    await allLoaded();
    expect(callsTo(f, 'alerts')[0].searchParams.has('severity')).toBe(false);
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.get('severity')).toBe('critical');
  });

  it('the sparkline is fixed at 90 days back whatever Range says; the trend follows Range; neither carries the team', async () => {
    const f = mount('team=Payments&range=30d');
    await allLoaded();
    const trends = callsTo(f, 'trend');
    expect(trends.filter(u => u.searchParams.get('since') === sparklineSince(new Date()))).toHaveLength(1);
    expect(trends.filter(u => u.searchParams.get('since') === trendSince('30d', new Date()))).toHaveLength(1);
    for (const u of trends) expect(u.searchParams.has('team')).toBe(false);
  });

  it('range=all sends no since on the trend, but the sparkline still has its 90-day since', async () => {
    const f = mount('');
    await allLoaded();
    const sinces = callsTo(f, 'trend').map(u => u.searchParams.get('since')).sort();
    expect(sinces).toEqual([null, sparklineSince(new Date())].sort());
  });

  it('a hand-edited baseline the API would reject is replaced by last before the request', async () => {
    const f = mount('baseline=garbage');
    await allLoaded();
    for (const u of callsTo(f, 'summary')) expect(u.searchParams.get('baseline')).toBe('last');
  });

  it('list filters, page and sort reach the alerts request with the API parameter names', async () => {
    const f = mount('');
    await allLoaded();
    act(() => { latest.list.toggleReopened(); });
    act(() => { latest.list.setSort('due'); });
    act(() => { latest.list.setPage(3); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('offset') === '20')).toBe(true));
    const last = callsTo(f, 'alerts').find(u => u.searchParams.get('offset') === '20')!;
    expect(last.searchParams.get('reopened')).toBe('true');
    expect(last.searchParams.get('sort')).toBe('due:desc');   // no header was chosen, so the first click on Due reverses the default order
    expect(last.searchParams.get('limit')).toBe('10');
  });

  it('a scope change resets the page: the first alerts request carrying the new team has offset 0', async () => {
    const f = mount('');
    await allLoaded();
    act(() => { latest.list.setPage(3); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('offset') === '20')).toBe(true));
    act(() => { latest.url.setTeam('Search'); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('team') === 'Search')).toBe(true));
    const first = callsTo(f, 'alerts').find(u => u.searchParams.get('team') === 'Search')!;
    expect(first.searchParams.get('offset')).toBe('0');
    expect(first.searchParams.has('repo')).toBe(false);
  });
});

describe('sanitising at key-build time', () => {
  it('with no active SLA, an Overdue toggle never reaches the request and the effective list shows it off', async () => {
    const f = mount('', { summary: { body: summaryFixture({ slaStatus: { critical: 'none', high: 'none' } }) } });
    await allLoaded();
    act(() => { latest.list.toggleOverdue(); });
    await act(async () => { await Promise.resolve(); });
    expect(latest.data.effectiveList.overdue).toBe(false);
    for (const u of callsTo(f, 'alerts')) expect(u.searchParams.has('overdue')).toBe(false);
  });

  it('with an active SLA the same toggle is sent', async () => {
    const f = mount('');
    await allLoaded();
    act(() => { latest.list.toggleOverdue(); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('overdue') === 'true')).toBe(true));
    expect(latest.data.effectiveList.overdue).toBe(true);
  });
});

describe('keepPreviousData', () => {
  it('keeps the previous summary on screen (stale) while the next key loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('', {
      summary: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: summaryFixture({ org: frontend ? 'frontend-org' : 'acme' }) };
      },
    });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('acme'));
    act(() => { latest.url.setCodebase('frontend'); });
    await waitFor(() => expect(latest.data.summary.stale).toBe(true));
    expect(latest.data.summary.data?.org).toBe('acme');
    expect(latest.data.summary.loading).toBe(false);
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('frontend-org'));
    expect(latest.data.summary.stale).toBe(false);
  });

  it('the alerts key keeps the previous rows on screen (stale) while a changed list filter loads the next ones', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('', {
      alerts: async url => {
        const reopened = url.searchParams.get('reopened') === 'true';
        if (reopened) await gate;
        return { body: alertsFixture([alertRow({ cveId: reopened ? 'CVE-2026-2222' : 'CVE-2026-1111' })]) };
      },
    });
    await waitFor(() => expect(latest.data.alerts.data?.rows[0].cveId).toBe('CVE-2026-1111'));
    act(() => { latest.list.toggleReopened(); });   // a list filter changes the alerts key
    await waitFor(() => expect(latest.data.alerts.stale).toBe(true));
    expect(latest.data.alerts.data?.rows[0].cveId).toBe('CVE-2026-1111');   // the previous rows stay on screen
    expect(latest.data.alerts.loading).toBe(false);
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.alerts.data?.rows[0].cveId).toBe('CVE-2026-2222'));
    expect(latest.data.alerts.stale).toBe(false);
  });
});

describe('an error never shows another key\'s data', () => {
  it('a new key that fails exposes the error and none of the previous key\'s rows', async () => {
    mount('', {
      summary: url => (url.searchParams.get('codebase') === 'frontend'
        ? { status: 500, body: { error: 'Internal Server Error' } }
        : { body: summaryFixture({ org: 'acme' }) }),
    });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('acme'));
    act(() => { latest.url.setCodebase('frontend'); });
    await waitFor(() => expect(latest.data.summary.errorText).toContain('Internal Server Error'));
    expect(latest.data.summary.data).toBeUndefined();
    expect(latest.data.summary.stale).toBe(false);
    expect(latest.data.summary.loading).toBe(false);
  });

  // Revert: `loading: r.isLoading && !payload` alone: during SWR's retry the failed key reads loading, and a consumer that checks `loading` first never shows the error.
  it('a failed key reads loading:false, stale:false with its error text and no data, also while SWR is retrying it', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let frontendCalls = 0;
    const f = mount('', {
      summary: async url => {
        if (url.searchParams.get('codebase') !== 'frontend') return { body: summaryFixture({ org: 'acme' }) };
        frontendCalls += 1;
        if (frontendCalls > 1) await gate;   // the retry stays in flight
        return { status: 500, body: { error: 'Internal Server Error' } };
      },
    }, { ...PRODUCTION_SWR, errorRetryInterval: 10 });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('acme'));
    act(() => { latest.url.setCodebase('frontend'); });
    await waitFor(() => expect(latest.data.summary.errorText).toContain('Internal Server Error'));
    await waitFor(() => expect(callsTo(f, 'summary').filter(u => u.searchParams.get('codebase') === 'frontend')).toHaveLength(2));   // the retry is in flight
    expect(latest.data.summary).toMatchObject({ loading: false, stale: false, data: undefined });
    expect(latest.data.summary.errorText).toContain('Internal Server Error');
    await act(async () => { release(); });
  });

  it('while the new key is still loading the previous data stays and is marked stale (no error yet)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('', {
      summary: async url => {
        if (url.searchParams.get('codebase') === 'frontend') await gate;
        return { body: summaryFixture({ org: url.searchParams.get('codebase') === 'frontend' ? 'frontend-org' : 'acme' }) };
      },
    });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('acme'));
    act(() => { latest.url.setCodebase('frontend'); });
    await waitFor(() => expect(latest.data.summary.stale).toBe(true));
    expect(latest.data.summary.data?.org).toBe('acme');
    expect(latest.data.summary.errorText).toBeNull();
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('frontend-org'));
  });

  it('a revalidation that fails on the SAME key keeps that key\'s own data, with the error beside it and stale false', async () => {
    let fail = false;
    mount('', { summary: () => (fail ? { status: 500, body: { error: 'Internal Server Error' } } : { body: summaryFixture({ org: 'acme' }) }) });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('acme'));
    fail = true;
    await act(async () => { await latest.mutate(latest.data.keys.summary); });
    await waitFor(() => expect(latest.data.summary.errorText).toContain('Internal Server Error'));
    expect(latest.data.summary.data?.org).toBe('acme');
    expect(latest.data.summary.stale).toBe(false);
  });
});

describe('the stale-repository state', () => {
  it('a repo absent from the loaded rows is not-found, and its alerts are never requested again', async () => {
    const f = mount('repo=acme%2Fghost');
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    const before = callsTo(f, 'alerts').length;
    act(() => { latest.list.toggleReopened(); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(callsTo(f, 'alerts')).toHaveLength(before);
    expect(latest.data.keys.alerts).toBeNull();
    expect(latest.data.alerts.data).toBeUndefined();
    expect(latest.data.effectiveRepo).toBeNull();
    expect(latest.data.summary.error).toBeUndefined();
  });

  it('a repo the alerts API rejects ("repo not tracked") becomes not-found without a page-level error, and is not resent', async () => {
    const f = mount('repo=acme%2Fledger', {
      alerts: { status: 400, body: { error: 'repo not tracked', repo: 'acme/ledger', service_tier: 'staging' } },
    });
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    expect(latest.data.summary.error).toBeUndefined();
    const before = callsTo(f, 'alerts').length;
    act(() => { latest.list.toggleRuntimeOnly(); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(callsTo(f, 'alerts')).toHaveLength(before);
  });

  // Revert: build repoStatus only from the rejected-repo state (set by the effect, a render later): one render shows the 400's text.
  it('a rejected repository reads not-found in the very render its error arrives: no render ever carries the 400 text', async () => {
    mount('repo=acme%2Fledger', { alerts: { status: 400, body: { error: 'unknown repo' } } });
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    expect(renders.some(d => d.alerts.error !== undefined)).toBe(false);
    expect(renders.filter(d => d.alerts.errorText !== null)).toEqual([]);
    // Every render that has the rejection also reads it as not-found, with no effective repository: no render has an alerts slot that
    // is blank (not loading, no rows, no error) under any other status, which the list would draw as an endless "Loading…".
    expect(renders.filter(d => d.repoStatus === 'not-found').every(d => d.effectiveRepo === null)).toBe(true);
    expect(renders.filter(d => !d.alerts.loading && d.alerts.data === undefined && d.alerts.errorText === null && d.repoStatus !== 'not-found')).toEqual([]);
  });

  it('a plain alerts failure (not a repo rejection) still shows its text and does not read as not-found', async () => {
    mount('repo=acme%2Fledger', { alerts: { status: 500, body: { error: 'Internal Server Error' } } });
    await waitFor(() => expect(latest.data.alerts.errorText).toMatch(/Couldn't load alerts/));
    expect(latest.data.repoStatus).toBe('ok');
    expect(latest.data.effectiveRepo).toBe('acme/ledger');
  });

  it('a new sync clears the rejection AND the cached 4xx: the repo is requested again under the app\'s own SWR settings and its rows show', async () => {
    let synced = false;
    const at = () => (synced ? '2026-09-23T06:00:00Z' : '2026-09-22T06:00:00Z');
    const f = mount('repo=acme%2Fledger', {
      summary: () => ({ body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: at() }) }) }),
      repos: () => ({ body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: at() }) }) }),
      alerts: () => (synced
        ? { body: alertsFixture([alertRow({ repo: 'acme/ledger', cveId: 'CVE-2026-7777' })]) }
        : { status: 400, body: { error: 'repo not tracked', repo: 'acme/ledger' } }),
    }, PRODUCTION_SWR);
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    expect(latest.data.keys.alerts).toBeNull();

    synced = true;   // the next sync tracks the repository
    await act(async () => { await latest.mutate(latest.data.keys.summary); });

    await waitFor(() => expect(latest.data.repoStatus).toBe('ok'));
    await waitFor(() => expect(latest.data.alerts.data?.rows[0]?.cveId).toBe('CVE-2026-7777'));
    expect(latest.data.keys.alerts).not.toBeNull();
    expect(callsTo(f, 'alerts')).toHaveLength(2);   // the rejected request, then exactly one fresh one
  });

  it('rejections are remembered per scope: after visiting another codebase, coming back to the rejected one sends no new alerts request', async () => {
    const f = mount('repo=acme%2Fledger', {
      alerts: { status: 400, body: { error: 'repo not tracked', repo: 'acme/ledger' } },
      repos: url => ({ body: reposFixture(REPO_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }),
    });
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    act(() => { nav().__resetSearch('codebase=frontend&repo=acme%2Fledger'); });
    await waitFor(() => expect(latest.data.keys.alerts).toContain('codebase=frontend'));   // a second scope, rejected in turn
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    const before = callsTo(f, 'alerts').length;
    act(() => { nav().__resetSearch('repo=acme%2Fledger'); });
    await waitFor(() => expect(latest.data.keys.repos).toMatch(/codebase=backend$/));
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    expect(latest.data.repoStatus).toBe('not-found');
    expect(latest.data.keys.alerts).toBeNull();
    expect(callsTo(f, 'alerts')).toHaveLength(before);
  });

  it('a repo present in the rows is ok and is sent as the alerts repo', async () => {
    const f = mount('repo=acme%2Fledger');
    await waitFor(() => expect(latest.data.repoStatus).toBe('ok'));
    expect(latest.data.effectiveRepo).toBe('acme/ledger');
    expect(callsTo(f, 'alerts').some(u => u.searchParams.get('repo') === 'acme/ledger')).toBe(true);
  });

  it('rows from the previous scope never mark a repo not-found while the new rows load (Back navigation)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('repo=acme%2Fledger', {
      repos: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: reposFixture(frontend ? [] : REPO_ROWS, { codebase: frontend ? 'frontend' : 'backend' }) };
      },
    });
    await waitFor(() => expect(latest.data.repoStatus).toBe('ok'));
    act(() => { nav().__resetSearch('codebase=frontend&repo=acme%2Fledger'); });
    await waitFor(() => expect(latest.data.repos.stale).toBe(true));
    expect(latest.data.repoStatus).toBe('pending');
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
  });

  it('a plain alerts failure (500) is shown in the alerts slot and does not touch repoStatus or the summary', async () => {
    mount('', { alerts: { status: 500, body: { error: 'Internal Server Error' } } });
    await waitFor(() => expect(latest.data.alerts.errorText).toContain('Internal Server Error'));
    expect(latest.data.repoStatus).toBe('none');
    expect(latest.data.summary.error).toBeUndefined();
  });
});

describe('refetch on sync change', () => {
  it('when the summary and the repos rows disagree on the sync time, the older summary is refetched once and the page settles', async () => {
    let summaryCalls = 0;
    const f = mount('', {
      summary: () => {
        summaryCalls += 1;
        return { body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: summaryCalls === 1 ? '2026-09-22T06:00:00Z' : '2026-09-23T06:00:00Z' }) }) };
      },
      repos: () => ({
        body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: '2026-09-23T06:00:00Z' }) }),
      }),
    });
    await waitFor(() => expect(callsTo(f, 'summary')).toHaveLength(2));
    await waitFor(() => expect(latest.data.summary.data?.sync.lastSuccessfulAt).toBe('2026-09-23T06:00:00Z'));
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(callsTo(f, 'summary')).toHaveLength(2);   // refetched once, then agreed: no loop
    expect(callsTo(f, 'repos')).toHaveLength(1);     // the newer one is left alone
  });

  // With a team selected the team table's summary and the header's codebase-only repos are keys of their own.
  // Revert: leave teamSummary / metaRepos out of the disagreement check (or its refresh list).
  it.each([
    ['the team table summary', 'summary', (u: URL) => !u.searchParams.has('team')],
    ['the header meta rows', 'repos', (u: URL) => !u.searchParams.has('team')],
  ] as const)('with a team selected, when %s is the one behind, only that key is refetched, once, and the page settles', async (_label, route, isUnscoped) => {
    const OLD = '2026-09-22T06:00:00Z', NEW = '2026-09-23T06:00:00Z';
    let behindCalls = 0;
    const answer = (url: URL) => {
      if (!isUnscoped(url)) return NEW;
      behindCalls += 1;
      return behindCalls === 1 ? OLD : NEW;
    };
    const routes = route === 'summary'
      ? {
        summary: (url: URL) => ({ body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: answer(url) }) }) }),
        repos: () => ({ body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: NEW }) }) }),
      }
      : {
        summary: () => ({ body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: NEW }) }) }),
        repos: (url: URL) => ({ body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: answer(url) }) }) }),
      };
    const f = mount('team=Payments', routes);
    await waitFor(() => expect(callsTo(f, route).filter(isUnscoped)).toHaveLength(2));
    const behind = () => (route === 'summary' ? latest.data.teamSummary : latest.data.metaRepos).data;
    await waitFor(() => expect(behind()?.sync.lastSuccessfulAt).toBe(NEW));
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(callsTo(f, route).filter(isUnscoped)).toHaveLength(2);                       // the lagging key: refetched once
    expect(callsTo(f, route).filter(u => !isUnscoped(u))).toHaveLength(1);              // the team-scoped key: left alone
  });

  it('a server that keeps answering with the old time does not cause a refetch loop', async () => {
    const f = mount('', {
      summary: { body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: '2026-09-22T06:00:00Z' }) }) },
      repos: () => ({
        body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: '2026-09-23T06:00:00Z' }) }),
      }),
    });
    await allLoaded();
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(callsTo(f, 'summary').length).toBeLessThanOrEqual(2);
  });
});
