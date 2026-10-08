import { NextRequest, NextResponse } from 'next/server';
import { listDevelopers, listDevelopersFromGitHub } from '@/lib/developers/service';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';

async function getHandler(req: NextRequest) {
  const orgParam = req.nextUrl.searchParams.get('org');
  const q = req.nextUrl.searchParams.get('q') || '';
  const source = req.nextUrl.searchParams.get('source');

  const orgCheck = requireAllowedOrg(orgParam);
  if (!orgCheck.ok) return orgCheck.res;
  const org = orgCheck.org;

  if (source === 'github') {
    try {
      return NextResponse.json(await listDevelopersFromGitHub(org, q || undefined));
    } catch {
      return NextResponse.json({ error: 'GitHub API error' }, { status: 500 });
    }
  }

  const limit = Number(req.nextUrl.searchParams.get('limit')) || 0;
  return NextResponse.json(await listDevelopers(org, { query: q || undefined, limit }));
}

export const GET = withRequestLog(getHandler);
