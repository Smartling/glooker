/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnScheduleRow from '@/app/settings/vuln-schedule-row';

const wrap = () => render(
  <SWRConfig value={{ provider: () => new Map(), fetcher: (u: string) => fetch(u).then(async r => { if (!r.ok) throw new Error('x'); return r.json(); }) }}>
    <VulnScheduleRow />
  </SWRConfig>,
);

it('renders a read-only row for the vulnerability sync', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    available: true, org: 'acme', running: false,
    schedule: { cron: '0 6 * * *', tz: 'America/New_York', next_run: '2026-09-29T10:00:00Z' }, syncs: [],
  }) }) as any;
  wrap();
  await waitFor(() => screen.getByText('Dependabot alerts sync'));
  expect(screen.getByText('acme')).toBeTruthy();
  expect(screen.getByText('0 6 * * *')).toBeTruthy();
  expect(screen.getByText('America/New_York')).toBeTruthy();
  expect(screen.getByText('Sep 29, 6:00 AM')).toBeTruthy();
  expect(screen.getByText('Configured by deployment')).toBeTruthy();
  expect(screen.queryByText('Edit')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('/api/vulnerabilities/syncs?limit=1');
});

it('renders nothing when the feature is disabled (404)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) }) as any;
  const { container } = wrap();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

it('renders nothing when the response says unavailable', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ available: false, reason: 'off' }) }) as any;
  const { container } = wrap();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});
