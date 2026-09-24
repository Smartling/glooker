/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-syncs-tab-polling.test.tsx
//
// the existing vuln-syncs-tab.test.tsx suite mounts a bare
// `SWRConfig value={{ provider: () => new Map() }}`, which leaves every other option at SWR's
// own library defaults (dedupingInterval: 2_000) — it never exercises the app-wide
// `SWRProvider` (src/lib/swr-provider.tsx, mounted in src/app/layout.tsx), whose
// dedupingInterval: 60_000 is what actually ships in production. This file mounts the real
// `SWRProvider`, with only its cache `provider` overridden (an isolated Map) so the cache
// doesn't leak across tests, and keeps its dedupingInterval: 60_000 to catch a 10s poll that
// config silently swallows.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import SWRProvider from '@/lib/swr-provider';
import VulnerabilitySyncsTab from '@/app/reports/vulnerability-syncs-tab';

const body = {
  available: true, running: false, schedule: { cron: '0 6 * * *', tz: 'America/New_York', next_run: '2026-09-23T10:00:00Z' },
  syncs: [],
};

function syncsFetchCalls(mockFetch: jest.Mock) {
  return mockFetch.mock.calls.filter(([url]) => url === '/api/vulnerabilities/syncs').length;
}

describe('VulnerabilitySyncsTab polling under the app-wide SWR config', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls /api/vulnerabilities/syncs again 10s after the first fetch, despite the app-wide 60s dedupingInterval', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    (global as any).fetch = mockFetch;

    render(
      <SWRProvider>
        <SWRConfig value={{ provider: () => new Map() }}>
          <VulnerabilitySyncsTab canAct={false} />
        </SWRConfig>
      </SWRProvider>,
    );

    // 1. Let the first fetch resolve.
    await waitFor(() => expect(screen.getByText(/0 6 \* \* \*/)).toBeTruthy());
    expect(syncsFetchCalls(mockFetch)).toBe(1);

    // 2. Advance 10s (the tab's refreshInterval) plus a margin.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(11_000);
    });

    // 3. The app-wide 60s dedupingInterval must not swallow this poll.
    expect(syncsFetchCalls(mockFetch)).toBeGreaterThanOrEqual(2);
  });
});
