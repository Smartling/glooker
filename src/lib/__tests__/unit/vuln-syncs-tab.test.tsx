/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-syncs-tab.test.tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitySyncsTab from '@/app/reports/vulnerability-syncs-tab';

const body = {
  available: true, running: false, schedule: { cron: '0 6 * * *', tz: 'America/New_York', next_run: '2026-09-23T10:00:00Z' },
  syncs: [
    { id: 3, triggerKind: 'schedule', triggeredBy: null, status: 'succeeded', startedAt: '2026-09-22T10:00:00Z', finishedAt: '2026-09-22T10:04:12Z', alertsFetched: 500, reposChecked: 50, newCount: 5, resolvedCount: 2, reopenedCount: 0, missingCount: 0, issues: [] },
    { id: 1, triggerKind: 'manual', triggeredBy: 'admin@x', status: 'succeeded', startedAt: '2026-09-20T10:00:00Z', finishedAt: '2026-09-20T10:04:00Z', alertsFetched: 480, reposChecked: 50, newCount: null, resolvedCount: null, reopenedCount: null, missingCount: null, issues: [] },
  ],
};
beforeEach(() => { (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }); });
const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

it('shows the schedule, counters, and "initial import" on the first sync', async () => {
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => expect(screen.getByText(/0 6 \* \* \*/)).toBeTruthy());
  expect(screen.getByText('5 / 2 / 0 / 0')).toBeTruthy();
  expect(screen.getByText('initial import')).toBeTruthy();
});

it('hides Sync now from viewers and shows it to admins', async () => {
  const { rerender } = render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => screen.getByText('initial import'));
  expect(screen.queryByText('Sync now')).toBeNull();
  rerender(wrap(<VulnerabilitySyncsTab canAct={true} />));
  await waitFor(() => expect(screen.getByText('Sync now')).toBeTruthy());
});

// the sync tab shares vulnerabilities-content.tsx's panelError helper (format.ts), which
// prefixes an SWR-level error with the panel's label.
it('renders an SWR-level fetch/parse error through the shared panelError text', async () => {
  (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  expect(await screen.findByText("Couldn't load vulnerability syncs: network down")).toBeTruthy();
});

// panelError no longer reads a data-level `{ error }` payload — no
// vulnerability route ever returns 200 with an `error` key, and the shared fetcher throws on every
// non-ok response, so that branch was dead and has been removed. This test exercises a server-error
// response (the 500 shape withRequestLog's catch-all sends): the fetcher throws, and its Error
// carries the same message, so it exercises the same rendering path the SWR-level test above does,
// just via a real HTTP error response instead of a rejected promise.
it('renders a server-error response (500) through the shared panelError text', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'org not configured' }) });
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  expect(await screen.findByText("Couldn't load vulnerability syncs: org not configured")).toBeTruthy();
});

// a poll (refreshInterval) that returns a 500 must not blank the table — SWR's fetcher
// throws, so `data` keeps the last good value and only `error` changes; the banner renders above
// the still-visible table, the same as an SWR-level network failure (the test below).
it('a poll that returns 500 keeps the last good table visible under the error banner', async () => {
  let getCalls = 0;
  (global as any).fetch = jest.fn((url: string, opts?: any) => {
    if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    getCalls++;
    if (getCalls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => body });
    return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) });
  });
  render(wrap(<VulnerabilitySyncsTab canAct={true} />));
  await waitFor(() => screen.getByText('initial import'));

  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(screen.getByText('Sync now')); // triggers the POST, then mutate() re-fetches (and gets the 500)

  expect(await screen.findByText("Couldn't load vulnerability syncs: Internal Server Error")).toBeTruthy();
  expect(screen.getByText('initial import')).toBeTruthy();
  expect(screen.getByText('Sync now')).toBeTruthy();
});

// a poll that fails after good data was already showing must not blank the table or hide the
// Sync now button — only the initial "no data yet" case should show the error alone.
it('a failed poll after good data shows both the error banner and the last good table', async () => {
  let getCalls = 0;
  (global as any).fetch = jest.fn((url: string, opts?: any) => {
    if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    getCalls++;
    if (getCalls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => body });
    return Promise.reject(new Error('network down'));
  });
  render(wrap(<VulnerabilitySyncsTab canAct={true} />));
  await waitFor(() => screen.getByText('initial import'));

  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(screen.getByText('Sync now')); // triggers the POST, then mutate() re-fetches (and fails)

  expect(await screen.findByText(/Couldn't load vulnerability syncs: network down/)).toBeTruthy();
  // The last good data is still on screen: the table and the Sync now button.
  expect(screen.getByText('initial import')).toBeTruthy();
  expect(screen.getByText('Sync now')).toBeTruthy();
});
