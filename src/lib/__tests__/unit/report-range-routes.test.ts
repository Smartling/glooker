jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/service', () => ({
  getReport: jest.fn(async () => ({ report: { id: 'r1', org: 'acme' }, developers: [] })),
  deleteReport: jest.fn(),
  ReportNotFoundError: class ReportNotFoundError extends Error {},
}));
jest.mock('@/lib/report/dev', () => ({
  getDevReport: jest.fn(async () => ({ report: { id: 'r1', org: 'acme' }, developer: { github_login: 'alice' }, allDevelopers: [], models: [] })),
  DeveloperNotFoundError: class DeveloperNotFoundError extends Error {},
}));
jest.mock('@/lib/report/commits', () => ({ getReportCommits: jest.fn(async () => []) }));
jest.mock('@/lib/jira', () => ({ getJiraIssues: jest.fn(async () => []) }));
jest.mock('@/lib/report/range', () => ({
  ...jest.requireActual('@/lib/report/range-options'),
  loadReportRangeWindow: jest.fn(async () => ({ org: 'acme', window: { since: 'a', until: 'b', days: 90 } })),
  getRangeJiraIssues: jest.fn(async () => [{ issue_key: 'J-1' }]),
}));
jest.mock('@/lib/auth', () => ({ requireAdmin: jest.fn(), extractUser: jest.fn(async () => null) }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({})),
  buildCostVisibility: jest.fn(async () => ({ canSeeCost: () => true })),
  stripDevCost: (d: any) => d,
  stripCostFields: (d: any) => d,
  stripModelCost: (m: any) => m,
  costCacheHeaders: () => ({}),
}));

import { GET as reportGET } from '@/app/api/report/[id]/route';
import { GET as devGET } from '@/app/api/report/[id]/dev/[login]/route';
import { GET as commitsGET } from '@/app/api/report/[id]/commits/route';
import { GET as jiraGET } from '@/app/api/report/[id]/jira-issues/route';
import { getReport } from '@/lib/report/service';
import { getDevReport } from '@/lib/report/dev';
import { getReportCommits } from '@/lib/report/commits';
import { getJiraIssues } from '@/lib/jira';
import { getRangeJiraIssues } from '@/lib/report/range';

const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: 'r1', login: 'alice', ...extra }) });
const req = (url: string) => {
  const r = new Request(`http://localhost${url}`) as any;
  r.nextUrl = new URL(r.url);
  return r;
};

beforeEach(() => jest.clearAllMocks());

it.each([
  ['report', () => reportGET(req('/api/report/r1?range=all'), p() as any)],
  ['dev', () => devGET(req('/api/report/r1/dev/alice?range=90D'), p() as any)],
  ['commits', () => commitsGET(req('/api/report/r1/commits?login=alice&range=x'), p() as any)],
  ['jira', () => jiraGET(req('/api/report/r1/jira-issues?login=alice&range=1y'), p() as any)],
])('%s route returns 400 on an invalid range', async (_n, call) => {
  const res = await call();
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'Invalid range' });
});

it('passes current when range is absent and the value when present', async () => {
  await reportGET(req('/api/report/r1'), p() as any);
  expect(getReport).toHaveBeenLastCalledWith('r1', 'current');
  await reportGET(req('/api/report/r1?range=12m'), p() as any);
  expect(getReport).toHaveBeenLastCalledWith('r1', '12m');
  await devGET(req('/api/report/r1/dev/alice?range=90d'), p() as any);
  expect(getDevReport).toHaveBeenLastCalledWith('r1', 'alice', '90d');
  await commitsGET(req('/api/report/r1/commits?login=alice&range=90d'), p() as any);
  expect(getReportCommits).toHaveBeenLastCalledWith('r1', 'alice', '90d');
});

it('dev route: a range-only developer returns 200 and an unknown one 404s', async () => {
  const dev = jest.requireMock('@/lib/report/dev');
  (getDevReport as jest.Mock).mockResolvedValueOnce({ report: { id: 'r1', org: 'acme' }, developer: { github_login: 'carol' }, allDevelopers: [], models: [], range: { key: '90d' } });
  expect((await devGET(req('/api/report/r1/dev/carol?range=90d'), p({ login: 'carol' }) as any)).status).toBe(200);
  (getDevReport as jest.Mock).mockRejectedValueOnce(new dev.DeveloperNotFoundError('nobody'));
  expect((await devGET(req('/api/report/r1/dev/nobody?range=90d'), p({ login: 'nobody' }) as any)).status).toBe(404);
});

it('jira-issues uses the per-report query for current and the range query otherwise', async () => {
  await jiraGET(req('/api/report/r1/jira-issues?login=alice'), p() as any);
  expect(getJiraIssues).toHaveBeenCalledWith('r1', 'alice');
  const res = await jiraGET(req('/api/report/r1/jira-issues?login=alice&range=90d'), p() as any);
  expect(getRangeJiraIssues).toHaveBeenCalledWith('acme', 'alice', { since: 'a', until: 'b', days: 90 });
  expect(await res.json()).toEqual([{ issue_key: 'J-1' }]);
});
