import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { updateProgress } from '@/lib/progress-store';
import { requestStop } from '@/lib/report-runner';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [rows] = await db.execute(
    `SELECT status FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (rows[0].status !== 'running') {
    return NextResponse.json({ error: 'Report is not running' }, { status: 400 });
  }

  requestStop(id);
  await db.execute(
    `UPDATE reports SET status = 'stopped', error = 'Stopped by user' WHERE id = ?`,
    [id],
  );
  updateProgress(id, { status: 'failed', step: 'Stopped by user', error: 'Stopped by user' });

  return NextResponse.json({ stopped: true });
}
