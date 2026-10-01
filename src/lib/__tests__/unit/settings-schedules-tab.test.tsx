/** @jest-environment jsdom */
// GLOOK-59 follow-up: Settings → Schedules manages report schedules and the Dependabot alerts
// sync schedule in one table.
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import SchedulesTab from '@/app/settings/schedules-tab';

const report = {
  id: 'r1', kind: 'report', org: 'acme', period_days: 14, cron_expr: '0 9 * * 1-5', timezone: 'UTC',
  enabled: 1, test_mode: 0, last_run_at: null, last_report_status: null, next_run_at: '2026-10-02T09:00:00Z',
};
const vuln = {
  id: 'v1', kind: 'vuln_sync', org: 'acme', period_days: 0, cron_expr: '0 6 * * *', timezone: 'America/New_York',
  enabled: 1, test_mode: 0, last_run_at: '2026-10-01T10:00:00Z', last_report_status: 'partial', next_run_at: '2026-10-02T10:00:00Z',
};

let calls: Array<{ url: string; init?: any }>;
beforeEach(() => {
  calls = [];
  (global as any).fetch = jest.fn((url: string, init?: any) => {
    calls.push({ url, init });
    const body = url === '/api/schedule' ? [report, vuln] : url === '/api/orgs' ? [{ login: 'acme' }] : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
});

const rowFor = async (type: string) => (await screen.findByText(type)).closest('tr') as HTMLElement;

it('lists both kinds with a Type column; the alerts row has no period and no Delete', async () => {
  render(<SchedulesTab />);
  const r = await rowFor('Commits & PRs');
  const v = await rowFor('Dependabot alerts');
  expect(within(r).getByText('14d')).toBeTruthy();
  expect(within(r).getByText('Delete')).toBeTruthy();
  expect(within(v).getByText('—')).toBeTruthy();
  expect(within(v).queryByText('Delete')).toBeNull();
  expect(within(v).getByText('Daily at 6 AM')).toBeTruthy();
  expect(within(v).getByText(/\(partial\)/)).toBeTruthy();
});

it('edits the alerts schedule without org, period or test mode, and offers no Delete', async () => {
  render(<SchedulesTab />);
  fireEvent.click(within(await rowFor('Dependabot alerts')).getByText('Edit'));
  const form = (await screen.findByText('Edit Schedule')).closest('.relative') as HTMLElement;
  expect(within(form).getByText(/Dependabot alerts sync for acme/)).toBeTruthy();
  expect(within(form).queryByText('Org')).toBeNull();
  expect(within(form).queryByText('Period')).toBeNull();
  expect(within(form).queryByText('Test mode')).toBeNull();
  expect(within(form).getByText('Cadence')).toBeTruthy();
  expect(within(form).getByText('Timezone')).toBeTruthy();
  expect(within(form).queryByRole('button', { name: 'Delete' })).toBeNull();
  fireEvent.click(within(form).getByText('Update Schedule'));
  await waitFor(() => expect(calls.some(c => c.url === '/api/schedule/v1' && c.init?.method === 'PUT')).toBe(true));
  const body = JSON.parse(calls.find(c => c.url === '/api/schedule/v1')!.init.body);
  expect(body).toMatchObject({ cronExpr: '0 6 * * *', timezone: 'America/New_York', enabled: true });
});

it('pauses the alerts schedule from the status toggle', async () => {
  render(<SchedulesTab />);
  fireEvent.click(within(await rowFor('Dependabot alerts')).getByText('Active'));
  await waitFor(() => expect(calls.some(c => c.url === '/api/schedule/v1' && c.init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(calls.find(c => c.url === '/api/schedule/v1')!.init.body).enabled).toBe(false);
});

it('surfaces a server error from delete or toggle instead of swallowing it', async () => {
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  (global as any).fetch = jest.fn((url: string, init?: any) => {
    if (init?.method === 'DELETE' || init?.method === 'PUT') {
      return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'nope from server' }) });
    }
    const body = url === '/api/schedule' ? [report, vuln] : url === '/api/orgs' ? [{ login: 'acme' }] : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  render(<SchedulesTab />);
  fireEvent.click(within(await rowFor('Dependabot alerts')).getByText('Active'));
  await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('nope from server'));
  fireEvent.click(within(await rowFor('Commits & PRs')).getByText('Delete'));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
  alertSpy.mockRestore();
});
