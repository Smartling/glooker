/** @jest-environment jsdom */
// GLOOK-58 Decision 15: both report pages hand every page-grid chart the SAME week domain, ending
// at the response's anchorWeek (not today), plus the response's coveredWeeks. The charts are
// replaced by recorders, so this checks the pages' wiring, not chart rendering (the chart suites
// cover that). Without it, a chart missing its coveredWeeks prop would show up only if the single
// browser hover happened to land on that chart.
import React from 'react';
import { render } from '@testing-library/react';
import { weekDomainEndingAt } from '@/components/charts/chart-format';
import OrgDetailPage from '@/app/report/[id]/org/page';
import DevDetailPage from '@/app/report/[id]/dev/[login]/page';

type Seen = { chart: string; weeks: string[]; coveredWeeks?: string[] };
const mockSeen: Seen[] = [];
let mockSwrData: Record<string, unknown> = {};

// Plain functions, not jest.fn(): jest.config sets restoreMocks, which would strip a jest.fn()'s
// implementation before each test.
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => ({ data: key ? mockSwrData[key] : undefined, isLoading: false, error: undefined }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'r1', login: 'alice' }),
  useRouter: () => ({ push: () => undefined }),
}));
jest.mock('@/lib/url-state', () => ({ useUrlState: () => ['impact', () => undefined] }));
jest.mock('@/app/chat-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/IntegrityBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Breadcrumb', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/charts/commit-type-donut', () => ({ CommitTypeDonut: () => null }));
jest.mock('@/components/charts/timeline-chart', () => ({
  TimelineChart: (p: { weeks: string[]; coveredWeeks?: string[] }) => {
    mockSeen.push({ chart: 'TimelineChart', weeks: p.weeks, coveredWeeks: p.coveredWeeks });
    return null;
  },
}));
jest.mock('@/components/charts/lines-changed-chart', () => ({
  LinesChangedChart: (p: { weeks: string[]; coveredWeeks?: string[] }) => {
    mockSeen.push({ chart: 'LinesChangedChart', weeks: p.weeks, coveredWeeks: p.coveredWeeks });
    return null;
  },
}));
jest.mock('@/components/charts/stacked-types-chart', () => ({
  StackedTypesChart: (p: { weeks: string[]; coveredWeeks?: string[] }) => {
    mockSeen.push({ chart: 'StackedTypesChart', weeks: p.weeks, coveredWeeks: p.coveredWeeks });
    return null;
  },
}));

// A historical report: its anchor week is months before any real "today", so a page that still
// built its domain from new Date() cannot pass.
const ANCHOR = '2026-07-06';
const COVERED = ['2026-06-22', '2026-06-29'];
const TIMELINE = [
  { week: '2026-06-22', commits: 3, prs: 1, avgLinesPerPr: 40, linesAdded: 30, linesRemoved: 10, avgComplexity: 3, aiPercent: 0, types: { feature: 3 } },
  { week: '2026-06-29', commits: 2, prs: 1, avgLinesPerPr: 20, linesAdded: 15, linesRemoved: 5, avgComplexity: 2, aiPercent: 50, types: { bug: 2 } },
];
const REPORT = {
  id: 'r1', org: 'acme', period_days: 14, status: 'completed',
  created_at: '2026-06-24T12:00:00Z', completed_at: '2026-07-08T12:00:00Z', run_metadata: null,
};
const DEV = {
  github_login: 'alice', github_name: 'Alice', avatar_url: '',
  total_prs: 2, total_commits: 5, lines_added: 45, lines_removed: 15,
  avg_complexity: 2.5, impact_score: 5, pr_percentage: 100, ai_percentage: 20,
  type_breakdown: { feature: 3, bug: 2 }, active_repos: ['acme/app'],
  total_jira_issues: 0, total_reviews: 0,
};

beforeEach(() => { mockSeen.length = 0; });
afterEach(() => jest.useRealTimers());

const ORG_CHARTS = [...Array(5).fill('TimelineChart'), 'LinesChangedChart', 'StackedTypesChart'];
const DEV_CHARTS = Array(6).fill('TimelineChart');

function expectEveryChartWired(expectedCharts: string[], expectedWeeks: string[], expectedCovered: string[]) {
  expect(mockSeen.map(s => s.chart).sort()).toEqual([...expectedCharts].sort());
  // One array per page, so syncId's index matching lines up.
  expect(new Set(mockSeen.map(s => s.weeks)).size).toBe(1);
  for (const s of mockSeen) {
    expect(s.weeks).toEqual(expectedWeeks);
    expect(s.coveredWeeks).toEqual(expectedCovered);
  }
}

it('the org page passes the anchor-week domain and coveredWeeks to all 7 page-grid charts', () => {
  mockSwrData = {
    '/api/report/r1/org': {
      report: REPORT, developers: [], timeline: TIMELINE, spendWindow: null,
      modelUsage: [], skillsUsage: [], unmergedSummary: null,
      coveredWeeks: COVERED, anchorWeek: ANCHOR,
    },
  };
  render(<OrgDetailPage />);
  const expectedWeeks = weekDomainEndingAt(ANCHOR);
  expect(expectedWeeks[expectedWeeks.length - 1]).toBe(ANCHOR);
  expectEveryChartWired(ORG_CHARTS, expectedWeeks, COVERED);
});

it('the dev page passes the anchor-week domain and coveredWeeks to all 6 TimelineCharts', () => {
  mockSwrData = {
    '/api/report/r1/dev/alice': {
      report: REPORT, developer: DEV, allDevelopers: [DEV], commits: [], timeline: TIMELINE,
      unmergedWork: { openPrs: [], branchCommits: [] }, skills: [], models: [],
      coveredWeeks: COVERED, anchorWeek: ANCHOR,
    },
  };
  render(<DevDetailPage />);
  expectEveryChartWired(DEV_CHARTS, weekDomainEndingAt(ANCHOR), COVERED);
});

it("a response without coveredWeeks and anchorWeek gives every chart [] and today's domain", () => {
  // Only Date is faked (everything else stays real, so React and RTL behave normally), which pins
  // "today" and removes any midnight race between the page's domain and the expected one.
  jest.useFakeTimers({
    now: new Date('2026-09-25T12:00:00Z'),
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate',
      'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
  const today = weekDomainEndingAt(undefined);
  expect(today[today.length - 1]).toBe('2026-09-21');

  mockSwrData = {
    '/api/report/r1/org': {
      report: REPORT, developers: [], timeline: TIMELINE, spendWindow: null,
      modelUsage: [], skillsUsage: [], unmergedSummary: null,
    },
  };
  render(<OrgDetailPage />);
  expectEveryChartWired(ORG_CHARTS, today, []);

  mockSeen.length = 0;
  mockSwrData = {
    '/api/report/r1/dev/alice': {
      report: REPORT, developer: DEV, allDevelopers: [DEV], commits: [], timeline: TIMELINE,
      unmergedWork: { openPrs: [], branchCommits: [] }, skills: [], models: [],
    },
  };
  render(<DevDetailPage />);
  expectEveryChartWired(DEV_CHARTS, today, []);
});
