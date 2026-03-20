import { NextRequest, NextResponse } from 'next/server';
import { listReports, createReport } from '@/lib/report/service';

export async function POST(req: NextRequest) {
  const { org, periodDays, testMode } = await req.json();

  if (!org || !periodDays) {
    return NextResponse.json({ error: 'org and periodDays are required' }, { status: 400 });
  }

  if (![3, 14, 30, 90].includes(Number(periodDays))) {
    return NextResponse.json({ error: 'periodDays must be 3, 14, 30, or 90' }, { status: 400 });
  }

  const id = await createReport({ org, periodDays: Number(periodDays), testMode: Boolean(testMode) });
  return NextResponse.json({ reportId: id });
}

export async function GET() {
  const rows = await listReports();
  return NextResponse.json(rows);
}
