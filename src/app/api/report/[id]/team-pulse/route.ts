import { NextRequest, NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { getTeamPulse } from '@/lib/team-pulse';
import db from '@/lib/db';
import { requireAllowedOrg, requireOrgMembership } from '@/lib/orgs/guard';
import { internalError } from '@/lib/api-error';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {

  const { id } = await params;
  const team = req.nextUrl.searchParams.get('team');
  const orgParam = req.nextUrl.searchParams.get('org');
  const withProjects = req.nextUrl.searchParams.get('withProjects') === 'true';

  if (!team) {
    return NextResponse.json({ error: 'team query param required' }, { status: 400 });
  }
  const orgCheck = requireAllowedOrg(orgParam);
  if (!orgCheck.ok) return orgCheck.res;
  const org = orgCheck.org;

  const membershipDenied = await requireOrgMembership(req.headers, org);
  if (membershipDenied) return membershipDenied;

  // Check report period
  const [reportRows] = await db.execute(
    `SELECT period_days FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!reportRows.length) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  if (reportRows[0].period_days < 14) {
    return NextResponse.json({ error: 'Report period must be at least 14 days for team pulse' }, { status: 400 });
  }

  // Get team members
  const [memberRows] = await db.execute(
    `SELECT tm.github_login
     FROM team_members tm
     JOIN teams t ON tm.team_id = t.id
     WHERE t.name = ? AND t.org = ?`,
    [team, org],
  ) as [any[], any];

  if (!memberRows.length) {
    return NextResponse.json({ error: 'Team not found or has no members' }, { status: 404 });
  }

  const members = memberRows.map((r: any) => r.github_login);

  try {
    const result = await getTeamPulse(id, team, org, members, { withProjects });
    return NextResponse.json(result);
  } catch (err) {
    return internalError('team-pulse', err);
  }
}

export const GET = withRequestLog(getHandler);
