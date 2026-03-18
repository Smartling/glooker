import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// PUT — update team (name, color, members)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const { name, color, members } = body;

  // Update team metadata
  if (name || color) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (name) { sets.push('name = ?'); vals.push(name.trim()); }
    if (color) { sets.push('color = ?'); vals.push(color); }
    vals.push(id);
    await db.execute(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  // Replace members if provided
  if (Array.isArray(members)) {
    await db.execute(`DELETE FROM team_members WHERE team_id = ?`, [id]);
    for (const login of members) {
      await db.execute(
        `INSERT IGNORE INTO team_members (team_id, github_login) VALUES (?, ?)`,
        [id, login],
      );
    }
  }

  return NextResponse.json({ updated: true });
}

// DELETE — delete team
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await db.execute(`DELETE FROM teams WHERE id = ?`, [id]);
  return NextResponse.json({ deleted: true });
}
