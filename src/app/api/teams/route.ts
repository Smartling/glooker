import { NextRequest, NextResponse } from 'next/server';
import { listTeams, createTeam, TeamDuplicateError } from '@/lib/teams/service';
import { requireAdmin } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  return NextResponse.json(await listTeams(org));
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await req.json();
  const { org, name } = body;

  if (!org || !name) return NextResponse.json({ error: 'org and name are required' }, { status: 400 });

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
