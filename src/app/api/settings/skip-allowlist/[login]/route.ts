import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { login } = await params;
  await db.execute(
    `DELETE FROM report_skip_allowlist WHERE github_login = ?`,
    [login],
  );
  return NextResponse.json({ ok: true });
}

export const DELETE = withRequestLog(deleteHandler);
