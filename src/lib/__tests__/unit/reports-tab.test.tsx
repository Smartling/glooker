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
        // The Dependabot alerts schedule fires sooner but is not a report schedule.
        { id: 'v1', org: 'acme', period_days: 0, enabled: 1, next_run_at: '2026-09-29T10:00:00Z', kind: 'vuln_sync' },
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
    const bar = await waitFor(() => document.querySelector('.h-1\\.5.bg-chart-track > div') as HTMLElement);
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

  it('resume revalidates a watched card\'s progress and lets the finish side effect fire again', async () => {
    // Reproduces GLOOK-59 final-fix item 1: a card observed finished as `stopped` (both once-guards
    // — the hook's `firedOnce` ref and the shared `finishedFired` set — already hold this id, exactly
    // as they would after the earlier `stopped` observation). Resume succeeds, the progress endpoint
    // starts reporting `running` again, and the card must both show live progress again and let the
    // finish side effect (list mutate + global cache bust) fire exactly once more when it completes.
    mockGlobalMutate.mockClear();
    let reportStatus: 'stopped' | 'running' = 'stopped';
    let progressCalls = 0;
    global.fetch = mockFetch({
      '/api/report/r1/resume': () => { reportStatus = 'running'; return { body: { resumed: true, reportId: 'r1' } }; },
      '/api/report/r1/progress': () => {
        progressCalls++;
        if (progressCalls === 1) {
          return { body: { status: 'stopped', step: 'Stopped by user', totalRepos: 0, processedRepos: 0, totalDevelopers: 5, completedDevelopers: 2 } };
        }
        if (progressCalls === 2) {
          return { body: { status: 'running', step: 'Fetching commits', totalRepos: 0, processedRepos: 0, totalDevelopers: 5, completedDevelopers: 3 } };
        }
        return { body: { status: 'completed', step: 'Done', totalRepos: 0, processedRepos: 0, totalDevelopers: 5, completedDevelopers: 5 } };
      },
      '/api/report': () => ({ body: [report({ id: 'r1', status: reportStatus, completed_at: reportStatus === 'stopped' ? '2026-09-22T10:20:00Z' : null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;

    // Same shape ReportsTabs hands down: ids seen running this session, and ids whose finish side
    // effect already ran — pre-seeded as if the earlier `stopped` observation already fired once.
    const observedRunning = new Set<string>(['r1']);
    const finishedFired = new Set<string>(['r1']);

    wrap(<ReportsTab canAct observedRunning={observedRunning} finishedFired={finishedFired} />);

    await screen.findByText('Stopped by user');

    // Past the progress hook's dedupingInterval (1000ms) — matching the precedent above — so the
    // resume click below causes a real revalidation instead of resolving from the recent cache.
    await new Promise((r) => setTimeout(r, 1100));

    fireEvent.click(await screen.findByText('Resume'));

    // The card must show live progress again, not the stale `stopped` bar.
    await screen.findByText('Fetching commits');

    // The resumed run finishes (progress endpoint moves on to `completed` on its own, via the
    // re-armed refreshInterval poll); the finish side effect must fire again now that resume
    // cleared both once-guards.
    await waitFor(() => expect(mockGlobalMutate).toHaveBeenCalledTimes(1), { timeout: 3000 });
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

  // ── Run flow (PR #77 review: the rewritten start/stop/delete flow had no coverage) ──

  it('starting a report shows its live progress: POST → list returns the pending row → progress is polled', async () => {
    let started = false;
    const calls: string[] = [];
    global.fetch = jest.fn((url: string, init?: any) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      let body: any;
      if (url === '/api/report' && init?.method === 'POST') { started = true; body = { reportId: 'r9' }; }
      else if (url.startsWith('/api/report/r9/progress')) body = { status: 'running', step: 'Fetching commits', totalRepos: 0, processedRepos: 0, totalDevelopers: 10, completedDevelopers: 3, logs: [] };
      else if (url === '/api/report') body = started ? [report({ id: 'r9', status: 'pending', completed_at: null, trigger_kind: 'manual' })] : [];
      else if (url === '/api/orgs') body = [{ login: 'acme', avatar_url: '' }];
      else body = [];
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    fireEvent.click(await screen.findByText('+ New report'));
    await screen.findByRole('option', { name: 'acme' });
    fireEvent.click(screen.getByText('Run Report'));
    await screen.findByText('Fetching commits');
    expect(screen.getByText('3 / 10 developers')).toBeTruthy();
    expect(calls).toContain('POST /api/report');
    expect(calls.some(c => c.startsWith('GET /api/report/r9/progress'))).toBe(true);
  });

  it.each([
    ['start', '/api/report', 'POST'],
    ['stop', '/api/report/r1/stop', 'POST'],
    ['delete', '/api/report/r1', 'DELETE'],
  ])('a failed %s shows the server error inline', async (action, failUrl, method) => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const row = action === 'stop' ? report({ status: 'running', completed_at: null }) : report();
    global.fetch = jest.fn((url: string, init?: any) => {
      if (url === failUrl && (init?.method ?? 'GET') === method) {
        return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: `${action} refused` }) });
      }
      const body = url === '/api/report' ? [row] : url === '/api/orgs' ? [{ login: 'acme', avatar_url: '' }]
        : url.includes('/progress') ? { status: 'running', step: 'x', totalRepos: 0, processedRepos: 0, totalDevelopers: 0, completedDevelopers: 0, logs: [] } : [];
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await screen.findByText('acme · 30 days');
    if (action === 'start') {
      fireEvent.click(screen.getByText('+ New report'));
      await screen.findByRole('option', { name: 'acme' });
      fireEvent.click(screen.getByText('Run Report'));
    } else if (action === 'stop') {
      fireEvent.click(screen.getByText('Stop'));
    } else {
      fireEvent.click(screen.getByTitle('Delete report'));
      fireEvent.click(await screen.findByText('Delete'));
    }
    await screen.findByText(`${action} refused`);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('confirming delete removes the report from the list', async () => {
    let deleted = false;
    global.fetch = jest.fn((url: string, init?: any) => {
      if (url === '/api/report/r1' && init?.method === 'DELETE') deleted = true;
      const body = url === '/api/report' ? (deleted ? [] : [report()]) : [];
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    fireEvent.click(await screen.findByTitle('Delete report'));
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(screen.queryByText('acme · 30 days')).toBeNull());
    expect(deleted).toBe(true);
  });

  it('offers Stop on a pending report, not only a running one', async () => {
    global.fetch = mockFetch({
      '/api/report/r1/progress': () => ({ body: { status: 'pending', step: 'Queued', totalRepos: 0, processedRepos: 0, totalDevelopers: 0, completedDevelopers: 0, logs: [] } }),
      '/api/report': () => ({ body: [report({ status: 'pending', completed_at: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await screen.findByText('acme · 30 days');
    expect(screen.getByText('Stop')).toBeTruthy();
  });
});
