/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TeamSummaryPage from '@/app/report/[id]/team/page';

const mockKeys: string[] = [];
let mockSwrData: Record<string, unknown> = {};
let mockUrl: Record<string, unknown> = {};
const mockTableProps: { team?: any; dev?: any } = {};

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    if (key) mockKeys.push(key);
    return { data: key ? mockSwrData[key.split('?team=')[0].includes('team-pulse') ? 'pulse' : key] : undefined, isLoading: false, error: undefined };
  },
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'r1' }), useRouter: () => ({ push: () => undefined }) }));
jest.mock('@/lib/url-state', () => ({
  useUrlState: (s: { key: string; default: unknown }) => [s.key in mockUrl ? mockUrl[s.key] : s.default, () => undefined],
  useUrlBatch: () => (fn: () => void) => fn(),
}));
jest.mock('@/app/chat-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/IntegrityBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/runs/DataFreshness', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ProjectsCard', () => ({ __esModule: true, default: (p: any) => <div>{p.subtitle}</div> }));
jest.mock('@/components/PageHeader', () => ({ __esModule: true, default: (p: any) => <div>{p.meta}{p.actions}{p.children}</div> }));
jest.mock('@/app/report/[id]/team/team-table', () => ({ __esModule: true, default: (p: any) => { mockTableProps.team = p; return null; } }));
jest.mock('@/app/report/[id]/team/dev-table', () => ({ __esModule: true, default: (p: any) => { mockTableProps.dev = p; return null; } }));

const REPORT = { id: 'r1', org: 'acme', period_days: 14, status: 'completed', created_at: '2026-10-27T09:00:00Z', completed_at: '2026-10-27T10:00:00Z', run_metadata: null };
const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 1, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, type_breakdown: {}, active_repos: [] };

beforeEach(() => {
  mockKeys.length = 0;
  mockUrl = {};
  mockSwrData = {
    '/api/report/r1': { report: REPORT, developers: [DEV] },
    '/api/report/r1?range=12m': {
      report: REPORT, developers: [DEV],
      range: { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 212, prCoveredSince: '2026-03-03' },
    },
    '/api/teams?org=acme': [{ id: 't1', name: 'Core', color: '#fff', members: ['alice'] }],
    pulse: { summary: 'Pulse text', health: { activeRatio: '1/1', trending: 'flat', trendDirection: 'stable' } },
  };
});

it('Current report sends no range parameter and shows no notes or labels', () => {
  mockUrl = { team: 'Core' };
  render(<TeamSummaryPage />);
  expect(mockKeys).toContain('/api/report/r1');
  expect(mockKeys.some(k => k.includes('range='))).toBe(false);
  expect(screen.getByRole('button', { name: 'Current report' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText(/days measured/)).toBeNull();
  expect(mockTableProps.dev.range).toBe('current');
});

it('12 months fetches the range, shows the measured-days and PR notes, and labels per-report sections', () => {
  mockUrl = { range: '12m', team: 'Core', view: 'individuals' };
  render(<TeamSummaryPage />);
  expect(mockKeys).toContain('/api/report/r1?range=12m');
  expect(screen.getByText('212 of 365 days measured')).toBeTruthy();
  expect(screen.getByText('PR and review data from Mar 3')).toBeTruthy();
  // Team Pulse stays on the current report and says so.
  expect(screen.getByText(/Team Pulse: Core/).parentElement!.textContent).toContain('Current report');
  expect(mockTableProps.dev.range).toBe('12m');
});

it('the team table aggregates with the range\'s measured days', () => {
  mockUrl = { range: '12m', view: 'teams' };
  render(<TeamSummaryPage />);
  expect(mockTableProps.team.periodDays).toBe(212);
});

it('labels follow the payload on screen when the selected range has not loaded yet', () => {
  // 12m selected, but keepPreviousData still serves the 90d payload.
  mockUrl = { range: '12m', team: 'Core', view: 'individuals' };
  mockSwrData['/api/report/r1?range=12m'] = {
    report: REPORT, developers: [DEV],
    range: { key: '90d', since: '2026-07-30', until: '2026-10-28', days: 90, measuredDays: 60, prCoveredSince: null },
  };
  render(<TeamSummaryPage />);
  expect(screen.getByText('60 of 90 days measured')).toBeTruthy();
  expect(screen.getByText(/Past 90 days\s*·/)).toBeTruthy();
  expect(screen.queryByText(/365/)).toBeNull();
  // The picker still shows the selected range.
  expect(mockTableProps.dev.range).toBe('12m');
});
