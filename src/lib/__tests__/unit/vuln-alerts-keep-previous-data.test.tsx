/** @jest-environment jsdom */
// the alerts SWR key includes
// alertFilterQuery(...), so every filter/search change used to swap the key
// to one with no cached data -> `alerts?.rows` went falsy -> the alerts panel
// fell back to "Loading…" -> AlertsTable (and its focused <input>) unmounted.
// `keepPreviousData: true` on that one useSWR call keeps the previous rows
// (and therefore the mounted, focused input) in place while the new key's
// fetch is in flight.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSearchParams = new URLSearchParams('');
const mockPathname = '/vulnerabilities';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a) }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
}));

const summary = {
  available: true,
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'ok', issues: [] },
  pivot: {
    rows: [],
    total: {
      team: 'Total',
      critical: { open: 5, resolved: 10, dismissed: 1, pctClosed: 66, overdue: 2, dueSoon: 1 },
      high: { open: 3, resolved: 4, dismissed: 0, pctClosed: 50, overdue: 0, dueSoon: 0 },
      unmeasuredRepos: 0,
    },
  },
  delta: { critical: { available: false }, high: { available: false } },
  kpi: { openCriticalOtherCodebases: null },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  scope: { property: 'service_tier', value: 'production' },
  slaPolicyInvalid: false,
  slaStatus: { critical: 'active', high: 'none' },
  policy: [{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9, until: null, pending: false }],
};

const trend = { series: [{ team: 'Zeta', points: [{ date: '2026-09-20', open: 3 }, { date: '2026-09-21', open: 2 }] }] };
const coverage = { needsTagging: [], excludedByPolicy: [], unmeasured: [] };

const alertRow = (overrides: Record<string, unknown> = {}) => ({
  repo: 'org/repo1', team: 'Zeta', severity: 'critical', severityChangedAt: null,
  cveId: 'CVE-2026-1', ghsaId: 'GHSA-1', summary: null, cvss: 9, epss: null,
  packageName: 'lodash', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
  createdAt: '2026-09-01T00:00:00Z', ageDays: 21, clockStart: '2026-09-01', dueDate: '2020-01-17', daysRemaining: -3,
  slaPolicyId: 'critical-2020-01', state: 'open', dismissedReason: null, resolvedAt: null,
  resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, htmlUrl: 'https://example/1',
  ...overrides,
});

const fetchMock = jest.fn((url: string) => {
  if (url.includes('/api/vulnerabilities/summary')) return Promise.resolve({ ok: true, status: 200, json: async () => summary } as any);
  if (url.includes('/api/vulnerabilities/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => trend } as any);
  if (url.includes('/api/vulnerabilities/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [alertRow()], totalCount: 1, truncated: false }) } as any);
  if (url.includes('/api/vulnerabilities/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => coverage } as any);
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
});

beforeEach(() => {
  fetchMock.mockClear();
  (global as any).fetch = fetchMock;
});

it('keeps the alerts search input mounted and focused across a filter-driven refetch', async () => {
  render(<VulnerabilitiesContent />);

  const input = (await screen.findByPlaceholderText('Search CVE, GHSA, package, repo')) as HTMLInputElement;
  input.focus();
  expect(document.activeElement).toBe(input);

  fireEvent.change(input, { target: { value: 'lodash' } });

  // The state update above swaps the alerts SWR key immediately (synchronously,
  // in the same render pass) — this is exactly where the old code, with no
  // `keepPreviousData`, dropped `alerts.rows` to undefined and rendered
  // "Loading…" in place of <AlertsTable>, unmounting the input and its focus.
  expect(document.activeElement).toBe(input);
  expect(screen.queryByText('Loading…')).toBeNull();
  expect(screen.getByDisplayValue('lodash')).toBe(input);

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([u]) => typeof u === 'string' && u.includes('/api/vulnerabilities/alerts') && u.includes('q=lodash'))).toBe(true);
  });

  // Same assertions once the refetch triggered by the new key has resolved.
  expect(document.activeElement).toBe(input);
  expect(screen.queryByText('Loading…')).toBeNull();
  expect(screen.getByDisplayValue('lodash')).toBe(input);
});
