/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { weekDomainEndingAt } from '@/components/charts/chart-format';
import DevDetailPage from '@/app/report/[id]/dev/[login]/page';

const mockKeys: string[] = [];
const mockWeeks: string[][] = [];
let mockSwrData: Record<string, unknown> = {};
let mockRange: string = 'current';
let mockSwrError: Record<string, Error> = {};
const mockMutate = jest.fn();

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => { if (key) mockKeys.push(key); return { data: key ? mockSwrData[key] : undefined, isLoading: false, error: key ? mockSwrError[key] : undefined, mutate: mockMutate }; },
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'r1', login: 'alice' }), useRouter: () => ({ push: () => undefined }) }));
jest.mock('@/lib/url-state', () => ({
  useUrlState: (s: { key: string; default: unknown }) => [s.key === 'range' ? mockRange : s.default, () => undefined],
}));
jest.mock('@/components/Breadcrumb', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/report/[id]/dev/[login]/usage-card', () => ({ ClaudeCodeUsageCard: () => <div>Claude Code usage</div> }));
jest.mock('@/components/charts/timeline-chart', () => ({ TimelineChart: (p: { weeks: string[] }) => { mockWeeks.push(p.weeks); return null; } }));
jest.mock('@/components/charts/lines-changed-chart', () => ({ LinesChangedChart: () => null }));
jest.mock('@/components/charts/stacked-types-chart', () => ({ StackedTypesChart: () => null }));
jest.mock('@/components/charts/commit-type-donut', () => ({ CommitTypeDonut: () => null }));

const ANCHOR = '2026-10-26';
const REPORT = { id: 'r1', org: 'acme', period_days: 14, status: 'completed', created_at: '2026-10-27T09:00:00Z', completed_at: '2026-10-27T10:00:00Z' };
const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 5, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0, total_reviews: 0, type_breakdown: {}, active_repos: [] };
const TIMELINE = [{ week: '2026-10-19', commits: 1, prs: 1, avgLinesPerPr: 1, linesAdded: 1, linesRemoved: 0, avgComplexity: 1, aiPercent: 0, types: {} }, { week: ANCHOR, commits: 1, prs: 0, avgLinesPerPr: 0, linesAdded: 1, linesRemoved: 0, avgComplexity: 1, aiPercent: 0, types: {} }];
const body = (extra = {}) => ({ report: REPORT, developer: DEV, allDevelopers: [DEV], commits: [], timeline: TIMELINE, coveredWeeks: [], anchorWeek: ANCHOR, ...extra });

beforeEach(() => {
  mockKeys.length = 0; mockWeeks.length = 0; mockSwrError = {}; mockMutate.mockClear();
  mockSwrData = {
    '/api/report/r1/dev/alice': body(),
    '/api/report/r1/dev/alice?range=12m': body({ range: { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 365, prCoveredSince: null } }),
    '/api/report/r1/dev/alice/summary': { summary: 'Good work', badges: [] },
  };
});

it('Current report: no range param, 90-day chart window, no labels', () => {
  mockRange = 'current';
  render(<DevDetailPage />);
  expect(mockKeys.some(k => k.includes('range='))).toBe(false);
  expect(mockWeeks[0]).toEqual(weekDomainEndingAt(ANCHOR, 90));
  expect(screen.queryAllByText('Current report').filter(e => e.tagName === 'SPAN')).toHaveLength(0);
  expect(screen.getByText("Claude Code usage")).toBeTruthy();
});

it('12 months: range fetch, 12-month chart window, notes, and per-report sections labelled', () => {
  mockRange = '12m';
  render(<DevDetailPage />);
  expect(mockKeys).toContain('/api/report/r1/dev/alice?range=12m');
  expect(mockKeys).toContain('/api/report/r1/dev/alice/summary'); // summary stays per report
  expect(mockWeeks[0]).toEqual(weekDomainEndingAt(ANCHOR, 365));
  expect(screen.getByText('No PR and review data in this range')).toBeTruthy();
  // Performance Summary is labelled; Claude Code usage is hidden in range mode.
  expect(screen.getAllByText('Current report').filter(e => e.tagName === 'SPAN').length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText("Claude Code usage")).toBeNull();
});

it('stale: 12m selected but only the current payload is available -> labelled and windowed as current', () => {
  mockRange = '12m';
  // keepPreviousData would hand back the previous (current) payload under the new key.
  const cur = body();
  mockSwrData['/api/report/r1/dev/alice?range=12m'] = cur;
  render(<DevDetailPage />);
  expect(screen.getByText(/acme/).textContent).toContain('14 days');
  expect(screen.getByText(/acme/).textContent).not.toContain('12 months');
  expect(mockWeeks[0]).toEqual(weekDomainEndingAt(ANCHOR, 90));
  expect(screen.queryAllByText('Current report').filter(e => e.tagName === 'SPAN')).toHaveLength(0);
});

it('stale: current selected but a 12m payload is shown -> labels reflect 12 months', () => {
  mockRange = 'current';
  mockSwrData['/api/report/r1/dev/alice'] = mockSwrData['/api/report/r1/dev/alice?range=12m'];
  render(<DevDetailPage />);
  expect(screen.getByText(/acme/).textContent).toContain('Past 12 months');
  expect(mockWeeks[0]).toEqual(weekDomainEndingAt(ANCHOR, 365));
  expect(screen.getAllByText('Current report').filter(e => e.tagName === 'SPAN').length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText("Claude Code usage")).toBeNull();
});

it('pending range: dims the content and shows Loading next to the picker', () => {
  mockRange = '12m';
  mockSwrData['/api/report/r1/dev/alice?range=12m'] = body(); // previous (current) payload still on screen
  render(<DevDetailPage />);
  expect(screen.getByRole('status').textContent).toMatch(/Loading/);
  expect(screen.getByTestId('range-content').className).toContain('opacity-50');
});

it('failed range: keeps the previous payload with a banner and retry', () => {
  mockRange = '12m';
  mockSwrData['/api/report/r1/dev/alice?range=12m'] = body();
  mockSwrError['/api/report/r1/dev/alice?range=12m'] = new Error('boom');
  render(<DevDetailPage />);
  expect(screen.getByRole('alert').textContent).toContain("Couldn't load Past 12 months. Showing Current report.");
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mockMutate).toHaveBeenCalled();
});

it('range-only developer: no summary fetch, and says why', () => {
  mockRange = '12m';
  mockSwrData['/api/report/r1/dev/alice?range=12m'] = body({ inCurrentReport: false, range: { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 365, prCoveredSince: null } });
  render(<DevDetailPage />);
  expect(mockKeys).not.toContain('/api/report/r1/dev/alice/summary');
  expect(screen.getByText('Not in the current report — no summary.')).toBeTruthy();
});
