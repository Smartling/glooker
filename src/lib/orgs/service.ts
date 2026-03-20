import { Octokit } from '@octokit/rest';

export async function listOrgs(): Promise<Array<{ login: string; avatar_url: string }>> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const orgs: Array<{ login: string; avatar_url: string }> = [];

  for await (const res of octokit.paginate.iterator(octokit.orgs.listForAuthenticatedUser, {
    per_page: 100,
  })) {
    orgs.push(...res.data.map((o) => ({
      login: o.login,
      avatar_url: o.avatar_url || '',
    })));
  }

  return orgs;
}
