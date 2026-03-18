import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { randomUUID } from 'crypto';

// GET — list all teams with members
export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  const [teams] = await db.execute(
    `SELECT id, org, name, color, created_at FROM teams WHERE org = ? ORDER BY name`,
    [org],
  ) as [any[], any];

  // Load members for each team
  for (const team of teams) {
    const [members] = await db.execute(
      `SELECT github_login, added_at FROM team_members WHERE team_id = ? ORDER BY added_at`,
      [team.id],
    ) as [any[], any];
    team.members = members.map((m: any) => m.github_login);
  }

  return NextResponse.json(teams);
}

// POST — create a new team
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { org, name, color, members } = body;

  if (!org || !name) return NextResponse.json({ error: 'org and name are required' }, { status: 400 });

  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO teams (id, org, name, color) VALUES (?, ?, ?, ?)`,
      [id, org, name.trim(), color || '#3B82F6'],
    );

    // Add members
    if (Array.isArray(members)) {
      for (const login of members) {
        await db.execute(
          `INSERT IGNORE INTO team_members (team_id, github_login) VALUES (?, ?)`,
          [id, login],
        );
      }
    }

    return NextResponse.json({ id, org, name: name.trim(), color: color || '#3B82F6', members: members || [] });
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: `Team "${name}" already exists for this org` }, { status: 409 });
    }
    throw err;
  }
}
