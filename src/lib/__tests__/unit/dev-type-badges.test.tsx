/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/report/r1/team/core',
}));

import DevTable from '@/app/report/[id]/team/dev-table';

const dev = {
  github_login: 'dev-a', github_name: 'Dev A', avatar_url: '', total_prs: 1, total_commits: 4,
  lines_added: 10, lines_removed: 2, avg_complexity: 3, impact_score: 5, pr_percentage: 50, ai_percentage: 0,
  type_breakdown: { feature: 2, chore: 1, other: 1 }, active_repos: [],
};

const renderTable = () => render(<DevTable developers={[dev] as never} reportId="r1" org="acme" filterLogins={new Set()} />);

it('team type badges use the badge fill and badge text classes, never a mark colour with text-white', () => {
  const { container } = renderTable();
  const badges = Array.from(container.querySelectorAll('span.rounded.text-xs')).filter(s => /^(feature|other)/.test(s.textContent ?? ''));
  expect(badges.map(b => b.textContent?.split(' ')[0])).toEqual(['feature', 'other']);
  const feature = badges[0].className;
  expect(feature).toContain('bg-chart-badge-feature-bg');
  expect(feature).toContain('text-chart-badge-feature-text');
  expect(feature).not.toContain('text-white');
});

it('an unknown type folds into the single other badge', () => {
  const { container } = renderTable();
  const other = Array.from(container.querySelectorAll('span.rounded.text-xs')).find(s => s.textContent?.startsWith('other'))!;
  expect(other.textContent).toBe('other 2');
  expect(container.textContent).not.toContain('chore');
});
