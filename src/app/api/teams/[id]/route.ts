import { NextRequest, NextResponse } from 'next/server';
import { updateTeam, deleteTeam, TeamNotFoundError } from '@/lib/teams/service';
import { requireAdmin } from '@/lib/auth';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json();

  try {
    await updateTeam(id, body);
    return NextResponse.json({ updated: true });
  } catch (err) {
    if (err instanceof TeamNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  await deleteTeam(id);
  return NextResponse.json({ deleted: true });
}
