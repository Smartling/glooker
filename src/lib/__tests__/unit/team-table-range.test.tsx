/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TeamTable from '@/app/report/[id]/team/team-table';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/url-state', () => ({ useUrlState: (s: { default: unknown }) => [s.default, () => undefined] }));

const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 3, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0, type_breakdown: {}, active_repos: [] } as any;
const TEAMS = [{ id: 't1', name: 'Core', color: '#fff', members: ['alice'] }];

beforeEach(() => mockPush.mockClear());

it('team drill-down keeps a non-current range', () => {
  render(<TeamTable developers={[DEV]} teams={TEAMS} reportId="r1" range="90d" />);
  fireEvent.click(screen.getByText('Core'));
  expect(mockPush).toHaveBeenCalledWith('/report/r1/team?view=individuals&team=Core&dev=alice&range=90d');
});

it('current range adds no range param', () => {
  render(<TeamTable developers={[DEV]} teams={TEAMS} reportId="r1" />);
  fireEvent.click(screen.getByText('Core'));
  expect(mockPush.mock.calls[0][0]).not.toContain('range=');
});
