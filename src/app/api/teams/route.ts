import { NextRequest, NextResponse } from 'next/server';
import { listTeams, createTeam, TeamDuplicateError } from '@/lib/teams/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg, requireOrgMembership } from '@/lib/orgs/guard';

async function getHandler(req: NextRequest) {
  const orgCheck = requireAllowedOrg(req.nextUrl.searchParams.get('org'));
  if (!orgCheck.ok) return orgCheck.res;

  const membershipDenied = await requireOrgMembership(req.headers, orgCheck.org);
  if (membershipDenied) return membershipDenied;

  return NextResponse.json(await listTeams(orgCheck.org));
}

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await req.json();
  const { org, name } = body;

  const orgCheck = requireAllowedOrg(org);
  if (!orgCheck.ok) return orgCheck.res;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  try {
    const team = await createTeam(body);
    return NextResponse.json(team);
  } catch (err) {
    if (err instanceof TeamDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
