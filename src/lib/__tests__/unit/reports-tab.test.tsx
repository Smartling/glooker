/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ReportsTab from '@/app/reports/reports-tab';

jest.mock('@/hooks/use-idle-aware-polling', () => ({ useIdleAwarePolling: jest.fn() }));

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
