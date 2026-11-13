/** @jest-environment jsdom */
// The Activity link is admin-only and sits with the people views, right after Org Summary.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

let auth: any;
jest.mock('next/navigation', () => ({ usePathname: () => '/activity', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/app/auth-context', () => ({ useAuth: () => auth }));
import NavBar from '@/components/NavBar';

const config = { vulnerabilities: { enabled: true }, jira: { enabled: true, projectsEnabled: true },
  latestReport: { id: 'r1', date: 'Nov 10', org: 'acme' } };
const renderNav = () => render(
  <SWRConfig value={{ provider: () => new Map(), fetcher: async () => config }}><NavBar /></SWRConfig>,
);
const navLabels = () => [...document.querySelectorAll('nav a')]
  .map((e) => e.childNodes[0]?.textContent?.trim()).filter(Boolean);

it('shows Activity to an admin, after Org Summary and before Projects, marked active on /activity', async () => {
  auth = { enabled: true, user: { role: 'admin', email: 'a@x' } };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  const labels = navLabels();
  expect(labels.indexOf('Activity')).toBe(labels.indexOf('Org Summary') + 1);
  expect(labels.indexOf('Projects')).toBe(labels.indexOf('Activity') + 1);
  expect(screen.getByText('Activity').closest('a')!.className).toMatch(/text-accent-light/);
});

it('shows Activity when auth is off (everyone is admin locally)', async () => {
  auth = { enabled: false, user: null };
  renderNav();
  await waitFor(() => expect(screen.getByText('Activity')).toBeTruthy());
});

it('hides Activity from a viewer', async () => {
  auth = { enabled: true, user: { role: 'viewer', email: 'v@x' } };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  expect(screen.queryByText('Activity')).toBeNull();
});
