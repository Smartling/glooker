import type { GitHubProvider, OrgMember, UserActivity, CommitData } from './github';
import type { FetchedAlert, AlertState, Severity, RawPropertyRow } from './vulnerabilities/types';
import { toIsoSecond } from './vulnerabilities/time';
import { mapPropertyRows } from './vulnerabilities/properties';
import type { MockVulnRepo } from '../../scripts/mock-identities';

let _identities: typeof import('../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../scripts/mock-identities');
  return _identities!;
}

// GLOOK-43: vulnerability mock fixtures. Two calls to listOrgDependabotAlerts within a
// process ("sweeps") return different data so mock mode exercises reopen/missing/new alerts.
let mockVulnSweeps = 0;
export function __resetMockVulnSweeps() { mockVulnSweeps = 0; }

function mockAlerts(sweep: number): FetchedAlert[] {
  const { MOCK_VULN_REPOS, MOCK_ORG } = getIdentities();
  const out: FetchedAlert[] = [];
  const mk = (repoId: number, name: string, n: number, severity: Severity, state: AlertState, createdDaysAgo: number, resolvedDaysAgo?: number): FetchedAlert => {
    const iso = (d: number) => toIsoSecond(new Date(Date.now() - d * 86400000));
    const resolved = resolvedDaysAgo === undefined ? null : iso(resolvedDaysAgo);
    return {
      repoId, repoFullName: `${MOCK_ORG}/${name}`, number: n, htmlUrl: `https://github.com/${MOCK_ORG}/${name}/security/dependabot/${n}`,
      state, severity, ghsaId: `GHSA-mock-${repoId}-${n}`, cveId: `CVE-2026-${repoId}${n}`, summary: `Mock advisory ${n} in ${name}`,
      cvssScore: severity === 'critical' ? 9.8 : 7.5, epssPercentage: 0.01, advisoryWithdrawnAt: null,
      packageName: ['lodash', 'minimist', 'jackson-databind', 'log4j-core'][n % 4], ecosystem: n % 2 ? 'npm' : 'maven',
      manifestPath: n % 2 ? 'package-lock.json' : 'pom.xml', relationship: n % 3 ? 'transitive' : 'direct',
      scope: n % 2 ? 'runtime' : null, firstPatchedVersion: n % 2 ? '1.2.3' : null,
      createdAt: iso(createdDaysAgo), updatedAt: iso(0),
      fixedAt: state === 'fixed' ? resolved : null, dismissedAt: state === 'dismissed' ? resolved : null,
      autoDismissedAt: state === 'auto_dismissed' ? resolved : null, dismissedReason: state === 'dismissed' ? 'tolerable_risk' : null,
    };
  };
  for (const r of MOCK_VULN_REPOS) {
    // flaky-service and silent-service return no alerts, so the sync status-checks them and marks
    // them unmeasured (error and dependabot-off respectively).
    if (r.statusCheck === 'error' || r.statusCheck === 'dependabot-off') continue;
    const base = r.repoId % 7 + 2;
    for (let n = 1; n <= base; n++) out.push(mk(r.repoId, r.name, n, n % 3 === 0 ? 'high' : 'critical', 'open', 10 + n * 9));
    out.push(mk(r.repoId, r.name, 50, 'critical', 'fixed', 120, 30));
    out.push(mk(r.repoId, r.name, 51, 'high', 'dismissed', 90, 20));
    out.push(mk(r.repoId, r.name, 52, 'critical', 'auto_dismissed', 80, 15));
  }
  if (sweep >= 2) {
    // reopen: api-service #50 goes fixed → open
    const i = out.findIndex(a => a.repoId === 9001 && a.number === 50);
    out[i] = { ...out[i], state: 'open', fixedAt: null };
    // missing: api-service #1 disappears from the sweep
    out.splice(out.findIndex(a => a.repoId === 9001 && a.number === 1), 1);
    // new: billing-service #60
    out.push(mk(9002, 'billing-service', 60, 'critical', 'open', 0));
  }
  return out;
}

export function createMockGitHubProvider(): GitHubProvider {
  return {
    async listOrgs() {
      const { MOCK_ORG } = getIdentities();
      return [{ login: MOCK_ORG, avatar_url: '' }];
    },

    async listOrgMembers(_org, log) {
      const { MOCK_DEVELOPERS } = getIdentities();
      log?.(`[mock] Returning ${MOCK_DEVELOPERS.length} mock members`);
      return MOCK_DEVELOPERS.map(d => ({
        login: d.githubLogin,
        avatarUrl: d.avatarUrl,
      }));
    },

    async fetchUserActivity(_org, user, _since, log) {
      const { MOCK_DEVELOPERS } = getIdentities();
      const dev = MOCK_DEVELOPERS.find(d => d.githubLogin === user);
      if (!dev) return { commits: [], prs: [] };

      log?.(`[mock] Generating fixture commits for ${user}`);

      const types = ['feature', 'bug', 'refactor', 'docs', 'test'] as const;
      const repos = ['api-service', 'web-app', 'shared-lib'];
      const commits: CommitData[] = [];
      const count = 3 + (dev.githubLogin.charCodeAt(0) % 3);

      for (let i = 0; i < count; i++) {
        const type = types[i % types.length];
        const repo = repos[i % repos.length];
        commits.push({
          sha: `mock${dev.githubLogin.replace(/-/g, '')}${String(i).padStart(4, '0')}`.padEnd(40, '0'),
          repo,
          author: dev.githubLogin,
          authorName: dev.githubName,
          authorEmail: dev.jiraEmail,
          avatarUrl: dev.avatarUrl,
          message: `${type}: mock commit ${i + 1} by ${dev.githubName}`,
          fullMessage: `${type}: mock commit ${i + 1} by ${dev.githubName}`,
          diff: `--- a/src/${type}.ts\n+++ b/src/${type}.ts\n@@ -1,3 +1,5 @@\n+// ${type} change\n+console.log("${type}");`,
          additions: 10 + i * 5,
          deletions: 2 + i,
          prNumber: 100 + i,
          prTitle: `${type}: ${dev.githubName}'s PR #${i + 1}`,
          committedAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
          aiCoAuthored: i === 0 && dev.team === 'Frontend',
          aiToolName: i === 0 && dev.team === 'Frontend' ? 'copilot' : null,
        });
      }

      return {
        commits,
        prs: commits.filter(c => c.prNumber).map(c => ({
          number: c.prNumber!,
          title: c.prTitle!,
          repo: c.repo,
          mergedAt: c.committedAt,
        })),
      };
    },

    async countReviewedPRs() {
      return { reviews: Math.floor(Math.random() * 15) };
    },

    async fetchOpenPRs(_org, user, _since, log) {
      const { MOCK_DEVELOPERS } = getIdentities();
      const dev = MOCK_DEVELOPERS.find((d: any) => d.githubLogin === user);
      const prs = dev?.mockOpenPrs ?? [];
      log?.(`[mock] fetchOpenPRs ${user}: ${prs.length}`);
      return prs;
    },

    async isCommitInDefaultBranch(_owner, _repo, sha) {
      // For the mock, mark every 3rd commit (by SHA char-code sum) as NOT in default (bare-branch commit)
      const n = String(sha).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      return n % 3 !== 0;
    },

    async fetchRepoEvents(_owner, repo, log) {
      log?.(`[mock] fetchRepoEvents for ${repo}`);
      return [];
    },

    async getBranchHeadSha(_owner, _repo, _branchName, log) {
      log?.(`[mock] getBranchHeadSha`);
      return null;
    },

    async fetchPullRequestCommits(_owner, _repo, pullNumber, log) {
      log?.(`[mock] fetchPullRequestCommits #${pullNumber}`);
      return [];
    },

    async compareBranchCommits(_owner, _repo, _headSha, log) {
      log?.(`[mock] compareBranchCommits ${_repo}`);
      return [];
    },

    async isShaInMergedPR(_owner, _repo, _sha, log) {
      log?.(`[mock] isShaInMergedPR`);
      return false;
    },

    // GLOOK-43: vulnerability fixtures (Task 12).
    async listOrgReposForVulns() {
      const { MOCK_VULN_REPOS, MOCK_ORG } = getIdentities();
      return MOCK_VULN_REPOS.map((r: MockVulnRepo) => ({ repoId: r.repoId, fullName: `${MOCK_ORG}/${r.name}`, archived: r.archived }));
    },
    async listOrgRepoProperties(_org, keys) {
      const { MOCK_VULN_REPOS, MOCK_ORG } = getIdentities();
      // GLOOK-43 Wave P: the mock fixtures are always keyed under the neutral default names
      // (team/service_tier/codebase_type) — mapPropertyRows below applies the *configured* keys,
      // so a mistyped VULN_*_PROPERTY trips the taxonomy guard in mock mode too.
      const raw: RawPropertyRow[] = MOCK_VULN_REPOS.map((r: MockVulnRepo) => ({
        repoId: r.repoId,
        fullName: `${MOCK_ORG}/${r.name}`,
        properties: [
          ...(r.team !== null ? [{ property_name: 'team', value: r.team }] : []),
          ...(r.serviceTier !== null ? [{ property_name: 'service_tier', value: r.serviceTier }] : []),
          ...(r.codebaseType !== null ? [{ property_name: 'codebase_type', value: r.codebaseType }] : []),
        ],
      }));
      return mapPropertyRows(raw, keys);
    },
    async listOrgDependabotAlerts(_org, log) {
      mockVulnSweeps++;
      log?.(`[mock] Dependabot sweep #${mockVulnSweeps}`);
      return mockAlerts(mockVulnSweeps);
    },
    async getRepoDependabotStatus(fullName) {
      const { MOCK_VULN_REPOS } = getIdentities();
      const r = MOCK_VULN_REPOS.find((x: MockVulnRepo) => fullName.endsWith(`/${x.name}`));
      if (r?.statusCheck === 'error') return { status: 'error' as const, detail: 'HTTP 500: mock status check failure' };
      if (r?.statusCheck === 'dependabot-off') return { status: 'dependabot-off' as const, detail: 'Dependabot alerts are disabled for this repository.' };
      return r?.archived ? { status: 'archived' as const } : { status: 'ok' as const };
    },
  };
}
