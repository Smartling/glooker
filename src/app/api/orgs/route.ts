import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export async function GET() {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    const orgs: Array<{ login: string; avatar_url: string }> = [];
    for await (const res of octokit.paginate.iterator(octokit.orgs.listForAuthenticatedUser, {
      per_page: 100,
    })) {
      orgs.push(...res.data.map((o) => ({
        login:      o.login,
        avatar_url: o.avatar_url || '',
      })));
    }
    return NextResponse.json(orgs);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
