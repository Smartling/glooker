import { defineConfig, devices } from '@playwright/test';

// Same mocked environment as `npm run dev:mock`, but against the production
// build (`next start`), which is what ships — the Next 16 CSP breakage only
// showed in a production build in a real browser.
const MOCK_ENV = {
  PORT: '3100',
  // Explicit so a developer's .env.local (DB_TYPE=mysql) cannot redirect the run.
  DB_TYPE: 'sqlite',
  SQLITE_PATH: 'smoke.db',
  // Org-scoped routes (projects board, jira-projects) 404 in production unless the org is allowlisted.
  ALLOWED_ORGS: 'mock-org',
  GITHUB_PROVIDER: 'mock',
  LLM_PROVIDER: 'mock',
  JIRA_ENABLED: 'true',
  JIRA_PROVIDER: 'mock',
  JIRA_PROJECTS_JQL: 'project = MOCK AND issuetype = Epic',
  VULNERABILITIES_ORG: 'mock-org',
  VULN_CODEBASE_GROUPS: '{"backend":["backend","api"],"frontend":["frontend"],"shared":["shared"]}',
  VULNERABILITIES_SLA_POLICY: '[{"id":"critical-2020-01","severity":"critical","effectiveFrom":"2020-01-08","days":7}]',
  CC_ANALYTICS_PROVIDER: 'mock',
  // Production mode with auth off needs both explicit opt-ins (see .env.example).
  AUTH_ENABLED: 'false',
  AUTH_ALLOW_ANONYMOUS: 'true',
  AUTH_ALLOW_ANONYMOUS_ADMIN: 'true',
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3100', ...devices['Desktop Chrome'] },
  webServer: {
    // scripts/seed.ts refuses NODE_ENV=production, so seed first without it and
    // only then start the production server.
    command: 'rm -f smoke.db smoke.db-shm smoke.db-wal && npx tsx scripts/seed.ts && NODE_ENV=production npx next start -p 3100',
    url: 'http://127.0.0.1:3100/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: MOCK_ENV,
  },
});
