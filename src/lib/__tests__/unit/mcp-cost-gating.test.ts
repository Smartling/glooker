jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/teams/service', () => ({ listTeams: jest.fn() }));

import { queryDeveloperStats } from '@/lib/mcp/queries';
import db from '@/lib/db/index';
import { listTeams } from '@/lib/teams/service';

const mockExecute = db.execute as jest.Mock;
const mockListTeams = listTeams as jest.Mock;
beforeEach(() => { mockExecute.mockReset(); mockListTeams.mockReset(); });

function mockReportResolution(org = 'acme') {
  mockExecute
    .mockResolvedValueOnce([[{ id: 'r1' }], null])   // resolveReportId
    .mockResolvedValueOnce([[{ org }], null])          // reportOrg
    .mockResolvedValueOnce([[                            // developer rows
      { github_login: 'alice', impact_score: '4', cc_total_cost: '10', cc_requests: '1' },
      { github_login: 'carol', impact_score: '3', cc_total_cost: '20', cc_requests: '2' },
    ], null]);
}

it('strips cc for non-teammates when requester is a non-admin team member', async () => {
  mockReportResolution('acme');
  mockListTeams.mockResolvedValueOnce([{ id: 't1', members: ['alice'] }, { id: 't2', members: ['carol'] }]);
  const out = await queryDeveloperStats({ report_id: 'r1' }, { githubLogin: 'alice', isAdmin: false, authDisabled: false }) as any;
  const alice = out.developers.find((d: any) => d.github_login === 'alice');
  const carol = out.developers.find((d: any) => d.github_login === 'carol');
  expect(alice.cc_total_cost).toBe(10);
  expect('cc_total_cost' in carol).toBe(false);
});

it('strips ALL cc when no requester is provided (safe default)', async () => {
  mockReportResolution('acme');
  const out = await queryDeveloperStats({ report_id: 'r1' }) as any;
  expect(out.developers.every((d: any) => !('cc_total_cost' in d))).toBe(true);
});

it('admin keeps all cc', async () => {
  mockReportResolution('acme');
  const out = await queryDeveloperStats({ report_id: 'r1' }, { githubLogin: 'x', isAdmin: true, authDisabled: false }) as any;
  expect(out.developers.every((d: any) => 'cc_total_cost' in d)).toBe(true);
});
