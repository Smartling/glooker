/** @jest-environment jsdom */
// The Projects nav link must show for a non-admin, who receives the PUBLIC config.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

jest.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/app/auth-context', () => ({ useAuth: () => ({ enabled: true, user: null, canAct: false }) }));
import NavBar from '@/components/NavBar';

const renderWith = (config: any) => render(
  <SWRConfig value={{ provider: () => new Map(), fetcher: async () => config }}><NavBar /></SWRConfig>,
);

it('shows Projects to a viewer when the public config says the board is on', async () => {
  renderWith({ provider: 'x', model: 'y', ready: true, vulnerabilities: { enabled: false, org: null },
    jira: { enabled: true, host: 'acme.atlassian.net', projectsEnabled: true }, latestReport: null });
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
});

it('hides Projects when the board is off', async () => {
  renderWith({ provider: 'x', model: 'y', ready: true, vulnerabilities: { enabled: false, org: null },
    jira: { enabled: true, host: null, projectsEnabled: false }, latestReport: null });
  await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
  expect(screen.queryByText('Projects')).toBeNull();
});
