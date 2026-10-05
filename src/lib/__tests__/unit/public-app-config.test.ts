// PR #81 split /api/llm-config into a full (admin) and a public (everyone else)
// payload. The public one dropped `jira` entirely, so for every non-admin the
// Projects nav link vanished (NavBar reads jira.enabled + projectsEnabled) and
// developer pages lost their Jira issue links (they read jira.host). Viewers get
// exactly the three fields the UI needs — nothing that names credentials.
jest.mock('@/lib/vulnerabilities/config', () => ({
  isVulnerabilitiesEnabled: () => false, getVulnerabilitiesOrg: () => null,
}));
import { getAppConfig, getPublicAppConfig } from '@/lib/app-config/service';

const KEYS = ['JIRA_ENABLED', 'JIRA_HOST', 'JIRA_USERNAME', 'JIRA_API_TOKEN', 'JIRA_PROJECTS_JQL'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

it('gives viewers jira.enabled, jira.host and jira.projectsEnabled', () => {
  Object.assign(process.env, {
    JIRA_ENABLED: 'true', JIRA_HOST: 'acme.atlassian.net', JIRA_USERNAME: 'svc@acme.com',
    JIRA_API_TOKEN: 'secret-token', JIRA_PROJECTS_JQL: 'project = SECRET AND status = "In Progress"',
  });
  expect(getPublicAppConfig().jira).toEqual({ enabled: true, host: 'acme.atlassian.net', projectsEnabled: true });
});

it('never gives viewers the JQL, the service-account username or credential hints', () => {
  Object.assign(process.env, {
    JIRA_ENABLED: 'true', JIRA_HOST: 'acme.atlassian.net', JIRA_USERNAME: 'svc@acme.com', JIRA_PROJECTS_JQL: 'project = SECRET',
  });
  const json = JSON.stringify(getPublicAppConfig());
  for (const leak of ['svc@acme.com', 'project = SECRET', 'JIRA_API_TOKEN', 'missing', 'username', 'hasApiToken']) {
    expect(json).not.toContain(leak);
  }
});

it('reports projectsEnabled false without a board, and the full config agrees', () => {
  process.env.JIRA_ENABLED = 'true';
  expect(getPublicAppConfig().jira.projectsEnabled).toBe(false);
  expect(getAppConfig().jira.projectsEnabled).toBe(false);
  process.env.JIRA_PROJECTS_JQL = 'project = X';
  expect(getAppConfig().jira.projectsEnabled).toBe(true);
});

it('reports Jira off for viewers when it is off', () => {
  expect(getPublicAppConfig().jira).toEqual({ enabled: false, host: null, projectsEnabled: false });
});
