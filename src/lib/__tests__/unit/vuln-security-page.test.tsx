/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-page.test.tsx
// The composed page against a routed fetch mock and the reactive navigation mock.
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';
import {
  KPI_ROW_H, OWNERSHIP_BODY_H, TREND_PLOT_H, ALERTS_STRIP_H, ALERTS_CARD_H, ALERT_LIST_H, RAIL_W,
  PAGE_MAX_W, PAGE_PAD, PAGE_GAP, FILTER_BAR_H, Z,
} from '@/app/vulnerabilities/dimensions';
import { SwrFresh, fetchRouter, summaryFixture, coverageFixture, coverageRow, reposFixture, repoRow, cell, REPO_ROWS, syncInfo } from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;
const params = (url: string) => new URL(url, 'http://x').searchParams;

function mount(search = '', routes: Parameters<typeof fetchRouter>[0] = {}) {
  nav().__resetSearch(search);
  const fetchMock = fetchRouter(routes);
  (global as any).fetch = fetchMock;
  render(<SwrFresh><VulnerabilitiesContent /></SwrFresh>);
  return fetchMock;
}

const rect = (top: number, bottom: number) =>
  ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('page frame', () => {
  it('has the spec max width and padding, laid out as a column with the page gap', async () => {
    mount('');
    const page = await screen.findByTestId('security-page');
    expect(page.style.maxWidth).toBe(`${PAGE_MAX_W}px`);
    expect([page.style.paddingTop, page.style.paddingRight, page.style.paddingBottom, page.style.paddingLeft])
      .toEqual([`${PAGE_PAD.top}px`, `${PAGE_PAD.x}px`, `${PAGE_PAD.bottom}px`, `${PAGE_PAD.x}px`]);
    expect(page.style.gap).toBe(`${PAGE_GAP}px`);
  });

  it("the sticky bar is a direct child of the container, sticky at the top, and the composer's own ancestors set no overflow", async () => {
    mount('');
    const bar = await screen.findByTestId('security-bar');
    expect(bar.parentElement).toBe(screen.getByTestId('security-page'));
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.top).toBe('0px');
    expect(bar.style.zIndex).toBe(String(Z.stickyBar));
    // jsdom only has the composer's own wrappers and the test container above the bar. The page's real
    // layout ancestors (app shell, `main`) are checked by the headless-Chrome measurement in the exit check.
    for (let el = bar.parentElement; el && el !== document.body; el = el.parentElement) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/overflow/);
      expect(el.className).not.toMatch(/overflow/);
    }
  });

  it('the bar keeps its height when a team is chosen (selecting a team never shifts the page)', async () => {
    mount('');
    const bar = await screen.findByTestId('security-bar');
    expect(bar.style.height).toBe(`${FILTER_BAR_H}px`);
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    await waitFor(() => expect(nav().__calls.length).toBeGreaterThan(0));
    expect(screen.getByTestId('security-bar').style.height).toBe(`${FILTER_BAR_H}px`);
  });
});

describe('views', () => {
  it('Overview stacks the KPI row, the ownership card and the trend card at their spec heights, with the page gap', async () => {
    mount('');
    expect((await screen.findByTestId('kpi-tiles')).style.height).toBe(`${KPI_ROW_H}px`);
    // The body and the plot carry the fixed heights. The outer cards hold their own headers, so they set none.
    expect(screen.getByTestId('ownership-card-body').style.height).toBe(`${OWNERSHIP_BODY_H}px`);
    expect(screen.getByTestId('ownership-card').style.height).toBe('');
    expect(screen.getByTestId('trend-plot').style.height).toBe(`${TREND_PLOT_H}px`);
    expect(screen.getByTestId('trend-card').style.height).toBe('');
    expect(screen.queryByTestId('alerts-strip')).toBeNull();
    expect(screen.getByRole('tabpanel').style.gap).toBe(`${PAGE_GAP}px`);
  });

  it('Alerts shows the 72px strip above a 776px card holding the 260px rail and the 560px list area', async () => {
    mount('view=alerts');
    expect((await screen.findByTestId('alerts-strip')).style.height).toBe(`${ALERTS_STRIP_H}px`);
    const card = screen.getByTestId('alerts-card');
    expect(card.style.height).toBe(`${ALERTS_CARD_H}px`);
    expect(card.style.gridTemplateColumns).toContain(`${RAIL_W}px`);
    expect(within(card).getByTestId('repo-rail').style.width).toBe(`${RAIL_W}px`);
    expect(within(card).getByTestId('alert-list-rows').style.height).toBe(`${ALERT_LIST_H}px`);
    expect(screen.queryByTestId('kpi-tiles')).toBeNull();
  });

  it('clicking a view tab pushes a history entry with scroll:false and swaps the view', async () => {
    mount('');
    fireEvent.click(await screen.findByRole('tab', { name: /^Alerts/ }));
    await waitFor(() => expect(screen.getByTestId('alerts-strip')).toBeTruthy());
    const call = nav().__calls.find((c: any) => params(c.url).get('view') === 'alerts');
    expect(call.kind).toBe('push');
    expect(call.opts).toEqual({ scroll: false });
  });
});

describe('header meta line', () => {
  // The repos route answers a team request with only that team's repositories, as the server does.
  const byTeam = (url: URL) => {
    const team = url.searchParams.get('team');
    return { body: reposFixture(team ? REPO_ROWS.filter(r => r.team === team) : REPO_ROWS, team ? { codebase: 'backend', team } : { codebase: 'backend' }) };
  };

  // Revert: build the line from `data.repos` (the team-scoped rows) instead of `data.metaRepos`.
  it('describes the codebase, not the filter: choosing an owning team leaves "N repositories · N owning teams" alone, and sends the codebase-only request', async () => {
    const f = mount('', { repos: byTeam });
    expect(await screen.findByText('Backend · 4 production repositories · 3 owning teams')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).includes('/repos?') && String(u).includes('team=Search'))).toBe(true));
    // Let every response, the team-scoped rows included, arrive and render; the line must still count the whole codebase.
    await act(async () => { await Promise.all(f.mock.results.map(r => r.value)); });
    expect(screen.getByText('Backend · 4 production repositories · 3 owning teams')).toBeTruthy();
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/repos?codebase=backend'))).toBe(true);
  });
});

describe('Alerts tab count', () => {
  it('sums open counts under Severity over the repos rows, including the unmeasured row\'s stored count', async () => {
    mount('');
    const count = await screen.findByTestId('alerts-tab-count');
    await waitFor(() => expect(count.textContent).toBe('13 open'));   // critical 10 + high 3
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('10 open'));
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('3 open'));
  });

  // Revert: always count from `data.repos.data`: the old scope's rows do not hold the repository, so the tab reads "0 open".
  it('with a repository selected, shows no number while the rows are the previous scope\'s, then the real one', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('repo=acme%2Fledger', {
      repos: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: reposFixture(frontend ? [repoRow('acme/ledger', 'Payments', { critical: cell({ open: 7 }) })] : REPO_ROWS, { codebase: frontend ? 'frontend' : 'backend' }) };
      },
    });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('2 open'));
    act(() => { nav().__resetSearch('codebase=frontend&repo=acme%2Fledger'); });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe(''));
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('7 open'));
  });

  it('without a repository the previous scope\'s number stays while the new rows load', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('', {
      repos: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: reposFixture(frontend ? [] : REPO_ROWS, { codebase: frontend ? 'frontend' : 'backend' }) };
      },
    });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('13 open'));
    act(() => { nav().__resetSearch('codebase=frontend'); });
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    expect(screen.getByTestId('alerts-tab-count').textContent).toBe('13 open');
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('0 open'));
  });

  it('narrows to the selected repository', async () => {
    mount('repo=acme%2Fledger');
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('2 open'));
  });
});

describe('"A date…" prefill', () => {
  // Revert: build "today" from toISOString() (UTC) in vulnerabilities-content: the prefill and the date input's max can name different days.
  it('is a week before the browser\'s own calendar day (local date parts), the same day the date input\'s max uses', async () => {
    // The local clock says 2031-03-15, nothing like the real UTC day, so only a local-parts "today" can give 2031-03-08.
    jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2031);
    jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(2);
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(15);
    try {
      mount('');
      fireEvent.change(await screen.findByLabelText('Compare to'), { target: { value: 'date' } });
      await waitFor(() => expect(nav().__calls.length).toBe(1));
      expect(params(nav().__calls[0].url).get('baseline')).toBe('2031-03-08');
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('filters write the URL without scrolling and without switching the view', () => {
  it.each([
    ['Codebase', 'frontend', 'codebase'],
    ['Owning team', 'Search', 'team'],
    ['Severity', 'high', 'severity'],
    ['Compare to', '7d', 'baseline'],
  ])('%s -> %s: one replace with scroll:false, view untouched', async (label, value, key) => {
    mount('view=alerts');
    fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    const call = nav().__calls[0];
    expect(call.kind).toBe('replace');
    expect(call.opts).toEqual({ scroll: false });
    const p = params(call.url);
    expect(p.get(key)).toBe(value);
    expect(p.get('view')).toBe('alerts');
  });

  it('changing Codebase clears the selected repository in the same write and keeps the view and team', async () => {
    mount('view=alerts&team=Payments&repo=acme%2Fledger');
    fireEvent.change(await screen.findByLabelText('Codebase'), { target: { value: 'frontend' } });
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    const p = params(nav().__calls[0].url);
    expect(p.has('repo')).toBe(false);
    expect(p.get('codebase')).toBe('frontend');
    expect(p.get('view')).toBe('alerts');
    expect(p.get('team')).toBe('Payments');
  });

  it('Reset filters clears the five filters and never changes the view', async () => {
    mount('view=alerts&codebase=frontend&team=Search&severity=high');
    fireEvent.click(await screen.findByText('Reset filters'));
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    expect(Object.fromEntries(params(nav().__calls[0].url).entries())).toEqual({ view: 'alerts' });
  });

  it('choosing a team puts team=<name> into the summary, coverage, repos and alerts requests', async () => {
    const f = mount('');
    fireEvent.change(await screen.findByLabelText('Owning team'), { target: { value: 'Search' } });
    await waitFor(() => {
      const urls = f.mock.calls.map(([u]) => String(u));
      for (const route of ['summary', 'coverage', 'repos', 'alerts']) {
        expect(urls.some(u => u.includes(`/${route}?`) && u.includes('team=Search'))).toBe(true);
      }
    });
  });

  it('the Owning team select shows the team already in the URL', async () => {
    mount('team=Payments');
    await waitFor(() => expect((screen.getByLabelText('Owning team') as HTMLSelectElement).value).toBe('Payments'));
  });
});

describe('scroll-up-only on a view switch', () => {
  it('scrolls up just enough that the content starts under the bar, and never scrolls down', async () => {
    const scrollBy = jest.fn();
    (window as any).scrollBy = scrollBy;
    let panelTop = 20;
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-testid') === 'security-bar') return rect(0, FILTER_BAR_H);
      if (this.getAttribute('role') === 'tabpanel') return rect(panelTop, panelTop + 500);
      return rect(0, 0);
    });
    mount('');
    fireEvent.click(await screen.findByRole('tab', { name: /^Alerts/ }));
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith(0, 20 - FILTER_BAR_H));

    scrollBy.mockClear();
    panelTop = 400;   // the content is already below the bar
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => expect(nav().__calls.length).toBe(2));
    await act(async () => { await Promise.resolve(); });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not scroll on first mount, even when the data is already cached so the page renders on the very first pass', async () => {
    // A shared SWR cache: the second mount finds the summary already cached, so the bar and the
    // panel exist during the first layout effect. Without the "skip first mount" guard that effect
    // would measure them and scroll.
    const cache = new Map();
    const Shared = ({ children }: { children: React.ReactNode }) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
    );
    nav().__resetSearch('view=alerts');
    (global as any).fetch = fetchRouter();
    const first = render(<Shared><VulnerabilitiesContent /></Shared>);
    await screen.findByTestId('alerts-strip');
    first.unmount();

    const scrollBy = jest.fn();
    (window as any).scrollBy = scrollBy;
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => rect(-500, -400));
    render(<Shared><VulnerabilitiesContent /></Shared>);
    expect(screen.getByTestId('alerts-strip')).toBeTruthy();   // rendered synchronously from the cache
    await act(async () => { await Promise.resolve(); });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('coverage drawer from the header', () => {
  it('the unmeasured badge opens the drawer and Esc closes it, returning focus to the badge', async () => {
    mount('', {
      coverage: { body: coverageFixture({ unmeasured: [coverageRow({ repoId: 9, openCritical: 4, detail: 'x' })] }) },
    });
    const badge = await screen.findByRole('button', { name: /unmeasured/ });
    fireEvent.click(badge);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(badge);
  });
});

describe('full-page states carried over from today', () => {
  it('an unknown team shows the 400\'s message, the known teams and "Clear team filter", which clears the team', async () => {
    mount('team=Z', { summary: { status: 400, body: { error: 'unknown team', known_teams: ['T1', 'T2'] } } });
    expect(await screen.findByText('unknown team')).toBeTruthy();
    expect(screen.getByText(/Known teams: T1, T2/)).toBeTruthy();
    fireEvent.click(screen.getByText('Clear team filter'));
    await waitFor(() => expect(params(nav().__calls[0].url).has('team')).toBe(false));
  });

  it('a summary error with no data yet shows the plain error line, not the page', async () => {
    mount('', { summary: { status: 500, body: { error: 'Internal Server Error' } } });
    expect(await screen.findByText("Couldn't load summary: Internal Server Error")).toBeTruthy();
    expect(screen.queryByTestId('security-bar')).toBeNull();
  });

  it('a summary error WITH data in hand still fails the page visibly, not a banner over stale figures', async () => {
    mount('', {
      summary: url => (url.searchParams.get('team') === 'Search'
        ? { status: 500, body: { error: 'Internal Server Error' } }
        : { body: summaryFixture() }),
    });
    expect(await screen.findByText('Security · acme')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    expect(await screen.findByText("Couldn't load summary: Internal Server Error")).toBeTruthy();
    expect(screen.queryByText('Security · acme')).toBeNull();
  });

  it('the unknown-team page wins over the plain error line when both could apply', async () => {
    mount('', {
      summary: url => (url.searchParams.get('team') === 'Search'
        ? { status: 400, body: { error: 'unknown team', known_teams: ['T1'] } }
        : { body: summaryFixture() }),
    });
    expect(await screen.findByText('Security · acme')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    expect(await screen.findByText('unknown team')).toBeTruthy();
    expect(screen.getByText(/Known teams: T1/)).toBeTruthy();
  });

  it('the unavailable page shows the reason, the config banner, the failed-sync line and the Sync history link', async () => {
    mount('', {
      summary: { body: {
        available: false, reason: 'No successful vulnerability sync yet.',
        sync: syncInfo({ lastStatus: 'failed', lastSuccessfulAt: null, issues: [{ kind: 'sync', message: 'boom' }] }),
        configErrors: [{ source: 'startup', variable: 'VULN_X', rule: 'VULN_X entry 1: bad' }],
      } },
    });
    expect(await screen.findByText('No successful vulnerability sync yet.')).toBeTruthy();
    expect(screen.getByText('VULN_X entry 1: bad')).toBeTruthy();
    expect(screen.getByText('The last sync failed: boom')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Sync history/ });
    expect(link.getAttribute('href')).toBe('/reports?tab=syncs');
    expect(link.className).toContain('underline');   // an in-page link: the underline is its non-colour cue
  });

  it('shows Loading… before the summary resolves', () => {
    nav().__resetSearch('');
    (global as any).fetch = jest.fn(() => new Promise(() => {}));
    render(<SwrFresh><VulnerabilitiesContent /></SwrFresh>);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
