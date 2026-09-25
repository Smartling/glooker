/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-syncs-tab.test.tsx
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitySyncsTab from '@/app/reports/vulnerability-syncs-tab';

const schedule = { cron: '0 6 * * *', tz: 'America/New_York', next_run: '2026-09-23T10:00:00Z' };

const succeededFirst = {
  id: 1, triggerKind: 'manual', triggeredBy: 'admin@x', status: 'succeeded',
  startedAt: '2026-09-20T10:00:00Z', finishedAt: '2026-09-20T10:04:00Z', alertsFetched: 480, reposChecked: 50,
  newCount: null, resolvedCount: null, reopenedCount: null, missingCount: null, issues: [],
};
const succeededSecond = {
  id: 3, triggerKind: 'schedule', triggeredBy: null, status: 'succeeded',
  startedAt: '2026-09-22T10:00:00Z', finishedAt: '2026-09-22T10:04:12Z', alertsFetched: 500, reposChecked: 50,
  newCount: 5, resolvedCount: 2, reopenedCount: 0, missingCount: 0, issues: [],
};
const failedSync = {
  id: 2, triggerKind: 'manual', triggeredBy: 'admin@x', status: 'failed',
  startedAt: '2026-09-21T10:00:00Z', finishedAt: '2026-09-21T10:01:00Z', alertsFetched: null, reposChecked: null,
  newCount: null, resolvedCount: null, reopenedCount: null, missingCount: null,
  issues: [{ kind: 'fetch', message: 'token invalid or expired' }],
};
const runningSync = {
  id: 4, triggerKind: 'manual', triggeredBy: 'admin@x', status: 'running',
  startedAt: '2026-09-23T09:00:00Z', finishedAt: null, alertsFetched: null, reposChecked: null,
  newCount: null, resolvedCount: null, reopenedCount: null, missingCount: null, issues: [],
};

function listBody(syncs: any[], running = false) {
  return { available: true, running, schedule, syncs };
}

/** Routes a mocked fetch by URL: the syncs list vs. one card's own `/progress` poll (keyed by
 * sync id), matching how the real API is split (GLOOK-43 follow-up). */
function mockFetchFor(syncs: any[], progressById: Record<number, any> = {}, running = false) {
  return jest.fn((url: string) => {
    const m = /\/api\/vulnerabilities\/syncs\/(\d+)\/progress/.exec(url);
    if (m) return Promise.resolve({ ok: true, status: 200, json: async () => progressById[Number(m[1])] });
    return Promise.resolve({ ok: true, status: 200, json: async () => listBody(syncs, running) });
  });
}

const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;
const statValue = (label: string) => screen.getByText(label).nextElementSibling!.textContent;

it('collapsed cards show the status chip, trigger label, and start time, with no stats until expanded', async () => {
  (global as any).fetch = mockFetchFor([succeededSecond, succeededFirst]);
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => expect(screen.getByText(/0 6 \* \* \*/)).toBeTruthy());
  expect(screen.getAllByText('succeeded')).toHaveLength(2);
  expect(screen.getByText('Scheduled')).toBeTruthy();
  expect(screen.getByText('Manual · admin@x')).toBeTruthy();
  // start time formatted exactly like the Reports tab (ET, "Sep 22, 6:00 AM" for 10:00 UTC).
  // Matched with \s (not a literal space) since ICU renders a narrow no-break space before AM/PM
  // on some Node builds.
  expect(screen.getByText(/Sep 22,\s*6:00\sAM/)).toBeTruthy();
  expect(screen.queryByText('initial import')).toBeNull();
  expect(screen.queryByText('New')).toBeNull();
});

it('clicking a finished first-sync card expands the stats grid: "initial import" and the Dashboard link', async () => {
  (global as any).fetch = mockFetchFor([succeededFirst]);
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => screen.getByText('Manual · admin@x'));
  fireEvent.click(screen.getByText('Manual · admin@x'));
  expect(await screen.findByText('initial import')).toBeTruthy();
  expect(screen.getByText(/Dashboard/).closest('a')?.getAttribute('href')).toBe('/vulnerabilities');
  expect(statValue('Alerts')).toBe('480');
  expect(statValue('Repos')).toBe('50');
});

it('clicking a finished non-first-sync card expands the New/Resolved/Reopened/Missing stat cells', async () => {
  (global as any).fetch = mockFetchFor([succeededSecond]);
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => screen.getByText('Scheduled'));
  fireEvent.click(screen.getByText('Scheduled'));
  await screen.findByText('New');
  expect(statValue('Alerts')).toBe('500');
  expect(statValue('Repos')).toBe('50');
  expect(statValue('New')).toBe('5');
  expect(statValue('Resolved')).toBe('2');
  expect(statValue('Reopened')).toBe('0');
  expect(statValue('Missing')).toBe('0');
});

it('a failed card expands and shows its issue, with dashes for the never-populated stats', async () => {
  (global as any).fetch = mockFetchFor([failedSync]);
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => screen.getByText('failed'));
  fireEvent.click(screen.getByText('failed'));
  expect(await screen.findByText('token invalid or expired')).toBeTruthy();
  expect(statValue('Alerts')).toBe('—');
  expect(statValue('Repos')).toBe('—');
  expect(statValue('New')).toBe('—');
  expect(statValue('Missing')).toBe('—');
});

it('a running card is not clickable, and shows the step, the x / y repos counter, and the logs panel from a mocked progress response', async () => {
  (global as any).fetch = mockFetchFor([runningSync], {
    4: { status: 'running', step: '[3/10] Checking Dependabot status', done: 3, total: 10, logs: ['[10:00:00] fetching alerts', '[10:00:05] sync failed: boom'] },
  }, true);
  render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => screen.getByText('running'));
  expect(await screen.findByText('[3/10] Checking Dependabot status')).toBeTruthy();
  expect(screen.getByText('3 / 10 repos')).toBeTruthy();
  expect(screen.getByText('Logs (2)')).toBeTruthy();
  expect(screen.getByText('[10:00:05] sync failed: boom')).toBeTruthy();
  // not clickable while running: no chevron, and clicking the header does nothing
  fireEvent.click(screen.getByText('running'));
  expect(screen.queryByText('Dashboard')).toBeNull();
});

it('hides Sync now from viewers and shows it to admins', async () => {
  (global as any).fetch = mockFetchFor([succeededFirst]);
  const { rerender } = render(wrap(<VulnerabilitySyncsTab canAct={false} />));
  await waitFor(() => screen.getByText('Manual · admin@x'));
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

// a poll (refreshInterval) that returns a 500 must not blank the cards — SWR's fetcher
// throws, so `data` keeps the last good value and only `error` changes; the banner renders above
// the still-visible cards, the same as an SWR-level network failure (the test below).
it('a poll that returns 500 keeps the last good cards visible under the error banner', async () => {
  let getCalls = 0;
  (global as any).fetch = jest.fn((url: string, opts?: any) => {
    if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    getCalls++;
    if (getCalls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => listBody([succeededFirst]) });
    return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) });
  });
  render(wrap(<VulnerabilitySyncsTab canAct={true} />));
  await waitFor(() => screen.getByText('Manual · admin@x'));

  fireEvent.click(screen.getByText('Sync now')); // triggers the POST, then mutate() re-fetches (and gets the 500)

  expect(await screen.findByText("Couldn't load vulnerability syncs: Internal Server Error")).toBeTruthy();
  expect(screen.getByText('Manual · admin@x')).toBeTruthy();
  expect(screen.getByText('Sync now')).toBeTruthy();
});

// a poll that fails after good data was already showing must not blank the cards or hide the
// Sync now button — only the initial "no data yet" case should show the error alone.
it('a failed poll after good data shows both the error banner and the last good cards', async () => {
  let getCalls = 0;
  (global as any).fetch = jest.fn((url: string, opts?: any) => {
    if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    getCalls++;
    if (getCalls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => listBody([succeededFirst]) });
    return Promise.reject(new Error('network down'));
  });
  render(wrap(<VulnerabilitySyncsTab canAct={true} />));
  await waitFor(() => screen.getByText('Manual · admin@x'));

  fireEvent.click(screen.getByText('Sync now')); // triggers the POST, then mutate() re-fetches (and fails)

  expect(await screen.findByText(/Couldn't load vulnerability syncs: network down/)).toBeTruthy();
  // The last good data is still on screen: the card and the Sync now button.
  expect(screen.getByText('Manual · admin@x')).toBeTruthy();
  expect(screen.getByText('Sync now')).toBeTruthy();
});
