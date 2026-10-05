import { NextRequest, NextResponse } from 'next/server';
import { validateScheduleBody } from '@/lib/schedule/validation';
import { updateSchedule, deleteSchedule, getScheduleKind, ScheduleNotFoundError, ScheduleNotDeletableError } from '@/lib/schedule/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function putHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json();
    const kind = await getScheduleKind(id);
    if (!kind) throw new ScheduleNotFoundError(id);
    const error = validateScheduleBody(body, kind);
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

async function deleteHandler(
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
    if (err instanceof ScheduleNotDeletableError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[api/schedule] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 });
  }
}

export const PUT = withRequestLog(putHandler);
export const DELETE = withRequestLog(deleteHandler);
