import { NextRequest, NextResponse } from 'next/server';
import { validateScheduleBody } from '@/lib/schedule/validation';
import { updateSchedule, deleteSchedule, ScheduleNotFoundError } from '@/lib/schedule/service';
import { requireAdmin } from '@/lib/auth';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json();
    const error = validateScheduleBody(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    await updateSchedule(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[api/schedule] PUT failed:', err);
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteSchedule(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/schedule] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 });
  }
}
