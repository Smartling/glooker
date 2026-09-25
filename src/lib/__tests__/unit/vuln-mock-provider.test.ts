import { createMockGitHubProvider, __resetMockVulnSweeps } from '@/lib/github-mock';
import { DEFAULT_PROPERTY_KEYS } from '@/lib/vulnerabilities/config';

beforeEach(() => __resetMockVulnSweeps());

it('covers every UI state across two sweeps', async () => {
  const p = createMockGitHubProvider();
  const repos = await p.listOrgReposForVulns('mock-org');
  const props = await p.listOrgRepoProperties('mock-org', DEFAULT_PROPERTY_KEYS);
  expect(repos.some(r => r.archived)).toBe(true);
  expect(props.rows.some(pr => pr.team === null)).toBe(true);
  expect(props.rows.some(pr => pr.serviceTier === 'non-production')).toBe(true);
  const s1 = await p.listOrgDependabotAlerts('mock-org');
  const s2 = await p.listOrgDependabotAlerts('mock-org');
  expect(new Set(s1.map(a => a.state))).toEqual(new Set(['open', 'fixed', 'dismissed', 'auto_dismissed']));
  expect(s1.some(a => a.severity === 'high')).toBe(true);
  const key = (a: any) => `${a.repoId}:${a.number}`;
  const k1 = new Set(s1.map(key)); const k2 = new Set(s2.map(key));
  expect([...k1].some(k => !k2.has(k))).toBe(true);                                    // one goes missing
  expect(s2.some(a => a.state === 'open' && s1.find(b => key(b) === key(a))?.state === 'fixed')).toBe(true); // one reopens
  const errRepo = repos.find(r => r.fullName.endsWith('flaky-service'))!;
  expect(await p.getRepoDependabotStatus(errRepo.fullName)).toMatchObject({ status: 'error' });
});

it('critical alerts are present', async () => {
  const p = createMockGitHubProvider();
  const s1 = await p.listOrgDependabotAlerts('mock-org');
  expect(s1.some(a => a.severity === 'critical')).toBe(true);
});

it('sweep 2 contains the new billing-service #60', async () => {
  const p = createMockGitHubProvider();
  await p.listOrgDependabotAlerts('mock-org'); // sweep 1
  const s2 = await p.listOrgDependabotAlerts('mock-org'); // sweep 2
  const added = s2.find(a => a.repoId === 9002 && a.number === 60);
  expect(added).toBeTruthy();
  expect(added?.repoFullName.endsWith('billing-service')).toBe(true);
  expect(added?.state).toBe('open');
});

it('flaky-service returns zero alerts (its status is checked separately, not swept)', async () => {
  const p = createMockGitHubProvider();
  const repos = await p.listOrgReposForVulns('mock-org');
  const flaky = repos.find(r => r.fullName.endsWith('flaky-service'))!;
  const s1 = await p.listOrgDependabotAlerts('mock-org');
  expect(s1.some(a => a.repoId === flaky.repoId)).toBe(false);
});

it('silent-service returns zero alerts and its status is dependabot-off, not error', async () => {
  const p = createMockGitHubProvider();
  const repos = await p.listOrgReposForVulns('mock-org');
  const silent = repos.find(r => r.fullName.endsWith('silent-service'))!;
  const s1 = await p.listOrgDependabotAlerts('mock-org');
  expect(s1.some(a => a.repoId === silent.repoId)).toBe(false);
  expect(await p.getRepoDependabotStatus(silent.fullName)).toMatchObject({ status: 'dependabot-off' });
});
