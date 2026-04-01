import { getGitHubProvider } from '@/lib/github';

export async function listOrgs(): Promise<Array<{ login: string; avatar_url: string }>> {
  const provider = getGitHubProvider();
  return provider.listOrgs();
}
