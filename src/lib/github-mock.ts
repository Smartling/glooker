import type { GitHubProvider, OrgMember, UserActivity, CommitData } from './github';

let _identities: typeof import('../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../scripts/mock-identities');
  return _identities!;
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
        name: d.githubName,
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
  };
}
