import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { parseSpendPeriodFromFilename } from '@/lib/cc-spend/filename';
import { uploadCcSpend, ReportNotFoundError } from '@/lib/cc-spend/service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id: reportId } = await params;

  let file: File | null = null;
  let manualStart: string | null = null;
  let manualEnd: string | null = null;
  try {
    const formData = await req.formData();
    const f = formData.get('file');
    if (f instanceof File) file = f;
    const ps = formData.get('periodStart');
    const pe = formData.get('periodEnd');
    if (typeof ps === 'string' && ps) manualStart = ps;
    if (typeof pe === 'string' && pe) manualEnd = pe;
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });

  // Manual form fields win; else parse from filename
  let periodStart = manualStart;
  let periodEnd = manualEnd;
  if (!periodStart || !periodEnd) {
    const parsed = parseSpendPeriodFromFilename(file.name);
    if (parsed) {
      periodStart = periodStart || parsed.start;
      periodEnd = periodEnd || parsed.end;
    }
  }
  if (!periodStart || !periodEnd) {
    return NextResponse.json({
      error: 'missing_period',
      message: 'Could not determine spend period from filename. Please provide periodStart and periodEnd (YYYY-MM-DD).',
    }, { status: 400 });
  }
  if (!ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd)) {
    return NextResponse.json({ error: 'Invalid period dates; expected YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const result = await uploadCcSpend({
      reportId,
      csvText: await file.text(),
      periodStart,
      periodEnd,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    if (err instanceof Error && err.message.startsWith('CSV')) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export const POST = withRequestLog(postHandler);
