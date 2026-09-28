/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ReportsTab from '@/app/reports/reports-tab';

jest.mock('@/hooks/use-idle-aware-polling', () => ({ useIdleAwarePolling: jest.fn() }));

// Spy on the global SWR cache bust independently of network-level fetch counting: SWR's own
// dedupingInterval can absorb a second real fetch to the same key within its window, which would
// mask a re-fired `globalMutate` call and make the remount regression test below a false pass. Only
// `useSWRConfig` is overridden — `useSWR`, `SWRConfig`, etc. stay real.
const mockGlobalMutate = jest.fn();
jest.mock('swr', () => {
  const actual = jest.requireActual('swr');
  // `__esModule` is non-enumerable on the real module, so a plain spread drops it — without it,
  // TS's `__importDefault` interop re-wraps this object as `{ default: <this object> }` instead of
  // preserving the real `default` (the useSWR function), and every `useSWR(...)` call in the
  // component under test breaks with "is not a function".
  return { __esModule: true, ...actual, useSWRConfig: () => ({ mutate: mockGlobalMutate }) };
});

const report = (over: any = {}) => ({
  id: 'r1', org: 'acme', period_days: 30, status: 'completed',
  created_at: '2026-09-22T10:00:00Z', completed_at: '2026-09-22T10:20:00Z',
  trigger_kind: 'schedule', triggered_by: null, health: null, ...over,
});

function mockFetch(routes: Record<string, (init?: any) => { status?: number; body: any }>) {
  return jest.fn((url: string, init?: any) => {
    const key = Object.keys(routes).find(k => url.startsWith(k))!;
    const r = routes[key](init);
    return Promise.resolve({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body });
  });
}

const wrap = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), fetcher: (u: string) => fetch(u).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); }) }}>{ui}</SWRConfig>);

describe('ReportsTab', () => {
  it('renders report cards through the shared header with trigger, duration and health', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [report({ health: { tone: 'warn', label: '2 partial' } })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [{ login: 'acme' }] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    expect(screen.getByText('succeeded')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('20m 00s')).toBeTruthy();
    expect(screen.getByText('2 partial')).toBeTruthy();
  });

  it('shows no trigger text for legacy rows', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [report({ trigger_kind: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    const { container } = wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    expect(container.textContent).not.toMatch(/Manual|Scheduled/);
  });

  it('surfaces a failed resume inline instead of alert()', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = mockFetch({
      '/api/report/r1/resume': () => ({ status: 409, body: { error: 'A report is already running.' } }),
      '/api/report': () => ({ body: [report({ status: 'failed', completed_at: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    fireEvent.click(await screen.findByText('Resume'));
    await waitFor(() => screen.getByText('A report is already running.'));
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows the next scheduled report in the toolbar', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [] }),
      '/api/schedule': () => ({ body: [
        { id: 's1', org: 'acme', period_days: 14, enabled: 1, next_run_at: '2026-09-29T13:00:00Z' },
        { id: 's2', org: 'other', period_days: 30, enabled: 0, next_run_at: null },
      ] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await waitFor(() => expect(screen.getByText(/Next scheduled: acme · 14d · Sep 29, 9:00 AM/)).toBeTruthy());
  });

  it('shows 100% progress for a completed report even with skipped developers', async () => {
    global.fetch = mockFetch({
      '/api/report/r1/progress': () => ({ body: {
        status: 'completed', step: 'Done', totalRepos: 0, processedRepos: 0,
        totalDevelopers: 10, completedDevelopers: 7,
      } }),
      '/api/report': () => ({ body: [report({ status: 'completed' })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    // Force the progress panel to render even though the report already reads `completed`: the
    // report was observed running earlier this page session (page-session retention), which is the
    // real path that exercises a completed-but-partial progress payload.
    wrap(<ReportsTab canAct observedRunning={new Set(['r1'])} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    const bar = await waitFor(() => document.querySelector('.h-1\\.5.bg-gray-800 > div') as HTMLElement);
    expect(bar.style.width).toBe('100%');
  });

  it('does not re-fire the finish side effect when a finished card remounts with the same observed sets', async () => {
    mockGlobalMutate.mockClear();
    global.fetch = mockFetch({
      '/api/report/r1/progress': () => ({ body: {
        status: 'completed', step: 'Done', totalRepos: 0, processedRepos: 0, totalDevelopers: 5, completedDevelopers: 5,
      } }),
      '/api/report': () => ({ body: [report({ status: 'completed' })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;

    // Same observedRunning/finishedFired instances across the toggle — exactly what ReportsTabs
    // (the real owner) hands to ReportsTab, which is what lets the bug reproduce: a fresh in-hook
    // ref would reset on every remount regardless of what's passed in here.
    const observedRunning = new Set<string>(['r1']);
    const finishedFired = new Set<string>();
    let setShow: (v: boolean) => void = () => {};
    function Root() {
      const [show, s] = React.useState(true);
      setShow = s;
      return show ? <ReportsTab canAct observedRunning={observedRunning} finishedFired={finishedFired} /> : null;
    }
    render(
      <SWRConfig value={{ provider: () => new Map(), fetcher: (u: string) => fetch(u).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); }) }}>
        <Root />
      </SWRConfig>,
    );

    // Initial mount: the observed report's progress resolves "completed" and fires the finish side
    // effect once (list mutate + global cache bust).
    await waitFor(() => expect(mockGlobalMutate).toHaveBeenCalledTimes(1));

    act(() => setShow(false));

    // Past the progress hook's dedupingInterval (1000ms) so the remount below causes SWR to
    // actually revalidate the progress key (a stale-cache mount otherwise resolves from cache
    // without invoking onSuccess again, which would make this assertion pass whether or not the
    // finishedFired guard exists).
    await new Promise((r) => setTimeout(r, 1100));

    // Remount (switching back to the reports tab) with the SAME observedRunning/finishedFired sets,
    // as ReportsTabs does.
    act(() => setShow(true));

    // The remounted card's progress poll resolves "completed" again — without the finishedFired
    // guard this re-runs the global cache bust every time the tab is revisited.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGlobalMutate).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('hides actions and the New report button for viewers', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [report({ status: 'failed', completed_at: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct={false} observedRunning={new Set()} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    expect(screen.queryByText('Resume')).toBeNull();
    expect(screen.queryByText('+ New report')).toBeNull();
  });
});
