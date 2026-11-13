/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams('org=acme') }));
jest.mock('@/app/auth-context', () => ({ useAuth: () => ({ enabled: true, user: { role: 'viewer' }, loading: false }) }));
import ActivityContent from '@/app/activity/activity-content';

let responses: Record<string, any>;
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    calls.push(url);
    const path = url.split('?')[0];
    return { ok: true, json: async () => responses[path] };
  });
});
const renderPage = () => render(
  <SWRConfig value={{ provider: () => new Map(), fetcher: (u: string) => fetch(u).then((r: any) => r.json()) }}>
    <ActivityContent />
  </SWRConfig>,
);
const base = { '/api/orgs': [{ login: 'acme' }] };

it('tells an unmapped developer why they see nothing, without requesting a calendar', async () => {
  responses = { ...base, '/api/activity-calendar/teams': { scope: 'none', reason: 'unmapped', teams: [] } };
  renderPage();
  await waitFor(() => expect(screen.getByText(/not linked to a GitHub login/)).toBeTruthy());
  expect(calls.some((u) => u.startsWith('/api/activity-calendar?'))).toBe(false);
});

it('tells a developer without a team to ask an admin', async () => {
  responses = { ...base, '/api/activity-calendar/teams': { scope: 'none', reason: 'no_team', teams: [] } };
  renderPage();
  await waitFor(() => expect(screen.getByText(/not on a team yet/)).toBeTruthy());
});

it("opens a developer's own team, names it, and shows no team picker for a single team", async () => {
  responses = {
    ...base,
    '/api/activity-calendar/teams': { scope: 'own', teams: [{ id: 't2', name: 'Web', color: '#00aa00' }] },
    '/api/activity-calendar': { team: { id: 't2', name: 'Web', color: '#00aa00' }, metric: 'commits',
      start: '2026-11-08', end: '2026-11-10', thresholds: [1, 2, 3],
      rows: [{ login: 'bob', name: 'Bob', avatarUrl: '', total: 2, days: { '2026-11-09': 2 } }] },
  };
  renderPage();
  await waitFor(() => expect(screen.getByText('Bob')).toBeTruthy());
  expect(calls).toContain('/api/activity-calendar?org=acme&team=t2&metric=commits');
  expect(screen.getByText(/^Web ·/)).toBeTruthy();
  expect(document.getElementById('activity-team')).toBeNull();
});
