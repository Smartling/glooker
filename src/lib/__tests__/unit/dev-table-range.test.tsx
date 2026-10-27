/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DevTable from '@/app/report/[id]/team/dev-table';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
jest.mock('@/lib/url-state', () => ({ useUrlState: (s: { default: unknown }) => [s.default, () => undefined] }));

const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 37, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0, type_breakdown: {}, active_repos: [] };

it('commit drill-down carries the range, and caches per range', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => [] }));
  (global as any).fetch = fetchMock;
  const { rerender } = render(<DevTable developers={[DEV]} reportId="r1" org="acme" filterLogins={new Set()} range="90d" />);
  await act(async () => { fireEvent.mouseEnter(screen.getByText('37')); });
  expect(fetchMock).toHaveBeenLastCalledWith('/api/report/r1/commits?login=alice&range=90d');
  rerender(<DevTable developers={[DEV]} reportId="r1" org="acme" filterLogins={new Set()} range="current" />);
  await act(async () => { fireEvent.mouseEnter(screen.getByText('37')); });
  expect(fetchMock).toHaveBeenLastCalledWith('/api/report/r1/commits?login=alice');
});
