import { NextRequest, NextResponse } from 'next/server';
import { validateScheduleBody } from '@/lib/schedule/validation';
import { listSchedules, createSchedule } from '@/lib/schedule/service';

export async function GET() {
  try {
    return NextResponse.json(await listSchedules());
  } catch (err) {
    console.error('[api/schedule] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const error = validateScheduleBody(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const id = await createSchedule(body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('[api/schedule] POST failed:', err);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
