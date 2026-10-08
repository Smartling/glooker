/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-view.test.tsx
// The Alerts view composed with the real hooks: strip, rail and list against a routed fetch mock and
// the reactive navigation mock. This is where URL history, request parameters and the data hook's
// stale-repository logic meet the three components.
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';
import { SEARCH_DEBOUNCE_MS } from '@/app/vulnerabilities/alert-list';
import {
  SwrFresh, fetchRouter, callsTo, reposFixture, repoRow, cell, REPO_ROWS, AL_RAIL_ROWS, alAlertRows, alAlertsRoute, alSummary, summaryFixture,
} from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;
const params = (url: string) => new URL(url, 'http://x').searchParams;

// Dates print through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });

function mount(search: string, routes: Parameters<typeof fetchRouter>[0] = {}) {
  nav().__resetSearch(search);
  const fetchMock = fetchRouter(routes);
  (global as any).fetch = fetchMock;
  render(<SwrFresh><VulnerabilitiesContent /></SwrFresh>);
  return fetchMock;
}
const lastAlerts = (f: jest.Mock) => callsTo(f, 'alerts').slice(-1)[0];
const railRow = (name: string) => screen.getAllByTestId('rail-row').find(el => el.getAttribute('data-repo') === name)!;
const cves = () => screen.getAllByTestId('alert-row').map(r => within(r).getByRole('link').textContent);

describe('one source for every count', () => {
  it('the strip, the rail\'s All row and the Alerts tab count all read the repos rows', async () => {
    mount('view=alerts');
    // REPO_ROWS: critical 3+2+1+4 = 10, high 1+0+2+0 = 3 (the unmeasured row's stored 4 is included).
    expect((await screen.findByTestId('strip-critical-open')).textContent).toBe('10');
    expect(screen.getByTestId('strip-high-open').textContent).toBe('3');
    expect(screen.getByTestId('rail-all').textContent).toContain('10 crit · 3 high open');
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('13 open'));
  });

  it('a team in the URL scopes all three through the repos request', async () => {
    const f = mount('view=alerts&team=Payments', {
      repos: url => ({ body: reposFixture(REPO_ROWS.filter(r => r.team === (url.searchParams.get('team') ?? r.team)), { codebase: 'backend', team: 'Payments' }) }),
    });
    expect((await screen.findByTestId('strip-critical-open')).textContent).toBe('5');
    expect(screen.getByTestId('strip-title').textContent).toBe('Payments · all repositories');
    expect(screen.getByTestId('rail-all').textContent).toContain('All Payments repositories');
    expect(callsTo(f, 'repos')[0].searchParams.get('team')).toBe('Payments');
  });
});

describe('a selected repository while its scope loads', () => {
  // Revert: decide the strip and the tab count with different predicates: the strip keeps the old scope's figure (dimmed) while the tab is blank, or one of them reads 0.
  it('the strip and the Alerts tab agree: both show no number until the new rows arrive, then both show the repository\'s own', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('view=alerts&repo=acme%2Fledger', {
      repos: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: reposFixture(frontend ? [repoRow('acme/ledger', 'Payments', { critical: cell({ open: 7 }) })] : REPO_ROWS, { codebase: frontend ? 'frontend' : 'backend' }) };
      },
    });
    await waitFor(() => expect(screen.getByTestId('strip-critical-open').textContent).toBe('2'));
    expect(screen.getByTestId('alerts-tab-count').textContent).toBe('2 open');
    act(() => { nav().__resetSearch('view=alerts&codebase=frontend&repo=acme%2Fledger'); });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe(''));
    expect(screen.getByTestId('strip-critical-open').textContent).toBe('—');
    expect(screen.getByTestId('strip-high-open').textContent).toBe('—');
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('strip-critical-open').textContent).toBe('7'));
    expect(screen.getByTestId('alerts-tab-count').textContent).toBe('7 open');
  });
});

describe('selecting a repository from the rail', () => {
  it('writes only repo, as a replace with scroll:false: no history entry, view and team untouched', async () => {
    mount('view=alerts', { repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }) });
    fireEvent.click(await waitFor(() => railRow('acme/audit-log')));
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    const call = nav().__calls[0];
    expect(call.kind).toBe('replace');
    expect(call.opts).toEqual({ scroll: false });
    const p = params(call.url);
    expect(p.get('repo')).toBe('acme/audit-log');
    expect(p.get('view')).toBe('alerts');
    expect(p.has('team')).toBe(false);
  });

  it('narrows the strip and the alerts request to that repository and tints the row; clicking it again clears it', async () => {
    const f = mount('view=alerts', { repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }) });
    fireEvent.click(await waitFor(() => railRow('acme/audit-log')));
    await waitFor(() => expect(screen.getByTestId('strip-title').textContent).toBe('acme/audit-log'));
    expect(screen.getByTestId('strip-critical-open').textContent).toBe('2');
    expect(railRow('acme/audit-log').className).toContain('bg-accent/10');
    await waitFor(() => expect(lastAlerts(f).searchParams.get('repo')).toBe('acme/audit-log'));
    fireEvent.click(railRow('acme/audit-log'));
    await waitFor(() => expect(screen.getByTestId('strip-title').textContent).toBe('All repositories'));
    await waitFor(() => expect(lastAlerts(f).searchParams.has('repo')).toBe(false));
  });

  it('an unmeasured rail row opens the drawer and does not touch the URL', async () => {
    mount('view=alerts');
    const row = await screen.findByTestId('rail-unmeasured');
    fireEvent.click(row);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(nav().__calls.length).toBe(0);
  });
});

describe('paging, sorting and the list parameters', () => {
  const all = alAlertRows(26);

  it('asks for ten at a time, from offset 0, and shows "1–10 of 26"', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    const q = callsTo(f, 'alerts')[0].searchParams;
    expect([q.get('limit'), q.get('offset'), q.get('state')]).toEqual(['10', '0', 'open']);
    expect(q.has('sort')).toBe(false);          // no active header: the server's default order
    expect(q.has('severity')).toBe(false);      // never severity=both
    expect(cves()).toHaveLength(10);
    expect(screen.getByTestId('alert-pager').textContent).toContain('1–10 of 26 alerts');
  });

  it('Next asks for offset 10 and shows the next ten; Previous returns', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('offset')).toBe('10'));
    await waitFor(() => expect(cves()[0]).toBe('CVE-2026-1011'));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(cves()[0]).toBe('CVE-2026-1001'));
  });

  it('the last page shows the remainder, and the list area keeps its 560px', async () => {
    mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(cves()[0]).toBe('CVE-2026-1011'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(cves()).toHaveLength(6));
    expect(screen.getByTestId('alert-pager').textContent).toContain('21–26 of 26 alerts');
    expect(screen.getByTestId('alert-list-rows').style.height).toBe('560px');
  });

  it('a header click sends sort=<key>:<dir> with its first direction and returns to offset 0', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('offset')).toBe('10'));
    fireEvent.click(screen.getByTestId('sort-age'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('sort')).toBe('age:desc'));
    expect(lastAlerts(f).searchParams.get('offset')).toBe('0');
    fireEvent.click(screen.getByTestId('sort-age'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('sort')).toBe('age:asc'));
    fireEvent.click(screen.getByTestId('sort-repo'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('sort')).toBe('repo:asc'));
  });

  it('every list control and a scope change returns to page 1', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all), repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }) });
    await screen.findAllByTestId('alert-row');
    const toPage2 = async () => {
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      await waitFor(() => expect(lastAlerts(f).searchParams.get('offset')).toBe('10'));
    };
    await toPage2();
    fireEvent.click(screen.getByRole('button', { name: 'Reopened' }));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('reopened')).toBe('true'));
    expect(lastAlerts(f).searchParams.get('offset')).toBe('0');
    await toPage2();
    fireEvent.click(railRow('acme/audit-log'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('repo')).toBe('acme/audit-log'));
    expect(lastAlerts(f).searchParams.get('offset')).toBe('0');
  });

  it('a page past the end after the result shrank lands on the last page', async () => {
    let total = 25;
    const f = mount('view=alerts', { alerts: url => alAlertsRoute(all.slice(0, total))(url) });
    await screen.findAllByTestId('alert-row');
    total = 15;      // a sync lands: two pages now, but the page still thinks there are three
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));      // page 3, offset 20: no rows, a total of 15
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('offset') === '20')).toBe(true));
    // Offset 20 was asked for and came back empty; the clamp then shows page 2 (its rows are already cached).
    await waitFor(() => expect(cves()).toHaveLength(5));
    expect(cves()[0]).toBe('CVE-2026-1011');
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  });
});

describe('search text and a view switch', () => {
  it('text typed inside the debounce window is applied when the user switches view, and is there when they come back', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(alAlertRows(3)) });
    const input = await screen.findByLabelText('Search alerts');
    fireEvent.change(input, { target: { value: 'lodash' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));     // well inside SEARCH_DEBOUNCE_MS
    // Applied by the unmount, not by the 300ms timer: the request is out before any timer could run.
    expect(callsTo(f, 'alerts').some(u => u.searchParams.get('q') === 'lodash')).toBe(true);
    fireEvent.click(await screen.findByRole('tab', { name: /^Alerts/ }));
    expect((await screen.findByLabelText('Search alerts') as HTMLInputElement).value).toBe('lodash');
    // The debounce timer of the unmounted list does not send it again.
    await act(async () => { await new Promise(r => setTimeout(r, SEARCH_DEBOUNCE_MS + 100)); });
    expect(callsTo(f, 'alerts').filter(u => u.searchParams.get('q') === 'lodash').length).toBe(1);
  });
});

describe('a repository that cannot be shown', () => {
  it('a repository missing from the repos rows shows the inline state, does not send that repo again, and "Show all repositories" clears it', async () => {
    const f = mount('view=alerts&repo=acme%2Fmissing', { alerts: alAlertsRoute(alAlertRows(4)) });
    expect(await screen.findByText(/Repository not found/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    // The data hook may send the repo once while the repos rows are still loading; once they say it is absent, never again.
    const sent = () => callsTo(f, 'alerts').filter(u => u.searchParams.get('repo') === 'acme/missing').length;
    const sentWhenShown = sent();
    expect(sentWhenShown).toBeLessThanOrEqual(1);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(sent()).toBe(sentWhenShown);
    // The scope falls back to everything: the All row is the selected one, and the strip is unscoped.
    expect(screen.getByTestId('rail-all').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('strip-title').textContent).toBe('All repositories');
    fireEvent.click(screen.getByRole('button', { name: 'Show all repositories' }));
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    expect(nav().__calls[0].kind).toBe('replace');
    expect(params(nav().__calls[0].url).has('repo')).toBe(false);
    await waitFor(() => expect(cves()).toHaveLength(4));
    expect(screen.queryByText(/Repository not found/)).toBeNull();
  });

  it('a repository the alerts API rejects shows the same inline state, is asked for once, and raises no page error', async () => {
    const f = mount('view=alerts&repo=acme%2Fledger', {
      alerts: url => (url.searchParams.get('repo') ? { status: 400, body: { error: 'unknown repo' } } : alAlertsRoute(alAlertRows(2))(url)),
    });
    expect(await screen.findByText(/Repository not found/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(screen.getByTestId('alerts-strip')).toBeTruthy();
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(callsTo(f, 'alerts').filter(u => u.searchParams.get('repo') === 'acme/ledger')).toHaveLength(1);
  });

  it('a plain alerts failure shows its error inside the card while the strip, the rail and the controls stay up', async () => {
    mount('view=alerts', { alerts: { status: 500, body: { error: 'Internal Server Error' } } });
    expect(await within(await screen.findByTestId('alert-list-rows')).findByText(/Couldn't load alerts: Internal Server Error/)).toBeTruthy();
    expect(screen.getByTestId('strip-critical-open').textContent).toBe('10');
    expect(screen.getAllByTestId('rail-row').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Search alerts')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('SLA states reach every Alerts-view consumer from one summary', () => {
  it('critical active, high pending: the strip, the rail footer and the Due column all say so', async () => {
    mount('view=alerts', {
      summary: url => ({ body: alSummary({ critical: 'active', high: 'pending' }, { appliedFilters: { codebase: 'backend', baseline: url.searchParams.get('baseline') ?? 'last' } }) }),
      repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }),
      alerts: alAlertsRoute([
        ...alAlertRows(1, { severity: 'critical', dueDate: '2026-09-10', daysRemaining: -5 }),
        ...alAlertRows(1, { severity: 'high', dueDate: null, daysRemaining: null }).map(r => ({ ...r, cveId: 'CVE-2026-9999' })),
      ]),
    });
    await screen.findAllByTestId('alert-row');
    expect(screen.getByTestId('strip-critical-tail').textContent).toContain('overdue');
    expect(screen.getByTestId('strip-high-tail').textContent).toContain('SLA starts Feb 1, 2099');
    expect(screen.getByTestId('rail-sla-note').textContent).toBe('Overdue counts critical only · high: SLA starts Feb 1, 2099');
    expect(screen.getAllByTestId('alert-due-sub').map(e => e.textContent)).toEqual(['5d OVERDUE', 'SLA starts Feb 1, 2099']);
    expect((screen.getByRole('button', { name: 'Overdue' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('no SLA active: the time toggles are disabled with the hint and the strip says why', async () => {
    mount('view=alerts', {
      summary: url => ({ body: summaryFixture({ slaStatus: { critical: 'none', high: 'none' }, policy: [], appliedFilters: { codebase: 'backend', baseline: url.searchParams.get('baseline') ?? 'last' } }) }),
    });
    expect((await screen.findByTestId('alert-sla-hint')).textContent).toBe('no SLA policy yet');
    expect((screen.getByRole('button', { name: 'Overdue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('strip-critical-tail').textContent).toContain('no SLA policy yet');
    expect(screen.getByTestId('rail-sla-note').textContent).toBe('No SLA policy yet · no overdue counts');
  });
});

describe('the unmeasured badge', () => {
  it('opens the drawer from the strip and returns focus to the badge on Esc', async () => {
    mount('view=alerts');
    const badge = await screen.findByTestId('strip-unmeasured');
    fireEvent.click(badge);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(badge);
  });
});
