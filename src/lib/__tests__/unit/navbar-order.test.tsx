/** @jest-environment jsdom */
// Top nav: the views (people first, then org, security, projects) on the left;
// Reports and Settings — tools, not views — on the right. Contributions shows for any signed-in user (the page scopes it to their team).
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
const labels = (root: Element) => [...root.querySelectorAll(':scope > a')]
  .map((e) => e.childNodes[0]?.textContent?.trim());

const groups = () => {
  const [primaryNav, rightSide] = [...document.querySelectorAll('nav > div')];
  return { primary: labels(primaryNav), right: labels(rightSide) };
};

it('orders the views for an admin and puts Reports with Settings on the right', async () => {
  auth = { enabled: true, user: { role: 'admin', email: 'a@x' } };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  const { primary, right } = groups();
  expect(primary).toEqual(['Home', 'Leaderboard', 'Contributions', 'Org Summary', 'Security', 'Projects']);
  expect(right[0]).toBe('Reports');
  expect(screen.getByText('Contributions').closest('a')!.className).toMatch(/text-accent-light/);
});

it('shows the report date on Leaderboard only', async () => {
  auth = { enabled: true, user: { role: 'admin', email: 'a@x' } };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  expect(screen.getAllByText('Nov 10')).toHaveLength(1);
  expect(screen.getByText('Nov 10').closest('a')!.textContent).toMatch(/^Leaderboard/);
});

it('gives every nav item a tooltip', async () => {
  auth = { enabled: true, user: { role: 'admin', email: 'a@x' } };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  for (const a of document.querySelectorAll('nav > div a')) expect(a.getAttribute('title')).toBeTruthy();
});

it('shows Contributions when auth is off (everyone is admin locally)', async () => {
  auth = { enabled: false, user: null };
  renderNav();
  await waitFor(() => expect(screen.getByText('Contributions')).toBeTruthy());
});

it('shows Contributions to a viewer too', async () => {
  auth = { enabled: true, user: { role: 'viewer', email: 'v@x' } };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  expect(groups().primary).toEqual(['Home', 'Leaderboard', 'Contributions', 'Org Summary', 'Security', 'Projects']);
});

it('hides Contributions when auth is on but nobody is signed in', async () => {
  auth = { enabled: true, user: null };
  renderNav();
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
  expect(screen.queryByText('Contributions')).toBeNull();
});
