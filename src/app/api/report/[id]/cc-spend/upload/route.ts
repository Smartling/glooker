import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import db from '@/lib/db';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

interface CcRow { cost: number; inputTokens: number; outputTokens: number; sessions: number; }

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id: reportId } = await params;

  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE id = ?`, [reportId],
  ) as [any[], any];
  if (!reportRows.length) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

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

  // Resolve period: manual form fields override, else parse from filename: ...-YYYY-MM-DD-to-YYYY-MM-DD.csv
  let periodStart = manualStart;
  let periodEnd = manualEnd;
  if (!periodStart || !periodEnd) {
    const match = file.name.match(/(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})/);
    if (match) {
      periodStart = periodStart || match[1];
      periodEnd = periodEnd || match[2];
    }
  }
  if (!periodStart || !periodEnd) {
    return NextResponse.json({
      error: 'missing_period',
      message: 'Could not determine spend period from filename. Please provide periodStart and periodEnd (YYYY-MM-DD).',
    }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return NextResponse.json({ error: 'Invalid period dates; expected YYYY-MM-DD' }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCsv(text).filter(r => r.some(c => c.length > 0));
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 });

  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iEmail = col('user_email');
  const iProduct = col('product');
  const iReq = col('total_requests');
  const iIn = col('total_prompt_tokens');
  const iOut = col('total_completion_tokens');
  const iCost = col('total_net_spend_usd');
  if (iEmail < 0 || iProduct < 0 || iCost < 0) {
    return NextResponse.json({ error: 'CSV missing required columns (user_email, product, total_net_spend_usd)' }, { status: 400 });
  }

  // Aggregate Claude Code rows by lowercased email
  const byEmail = new Map<string, CcRow>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row[iProduct]?.trim() !== 'Claude Code') continue;
    const email = row[iEmail]?.trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email) || { cost: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
    existing.cost += Math.round(parseFloat(row[iCost] || '0') * 100); // dollars → cents
    existing.inputTokens += parseInt(row[iIn] || '0', 10) || 0;
    existing.outputTokens += parseInt(row[iOut] || '0', 10) || 0;
    existing.sessions += parseInt(row[iReq] || '0', 10) || 0;
    byEmail.set(email, existing);
  }

  // Build email → github_login map from commit_analyses.author_email and user_mappings.jira_email
  const emailToLogin = new Map<string, string>();

  const [commitEmails] = await db.execute(
    `SELECT DISTINCT LOWER(author_email) AS email, github_login
     FROM commit_analyses
     WHERE report_id = ? AND author_email IS NOT NULL AND author_email <> ''`,
    [reportId],
  ) as [any[], any];
  for (const row of commitEmails) {
    if (row.email && row.github_login) emailToLogin.set(row.email, row.github_login);
  }

  const [jiraMappings] = await db.execute(
    `SELECT LOWER(jira_email) AS email, github_login
     FROM user_mappings
     WHERE jira_email IS NOT NULL AND jira_email <> ''`,
  ) as [any[], any];
  for (const row of jiraMappings) {
    if (row.email && row.github_login && !emailToLogin.has(row.email)) {
      emailToLogin.set(row.email, row.github_login);
    }
  }

  // Reset all cc_* columns for this report, then update matched developers
  await db.execute(
    `UPDATE developer_stats
       SET cc_total_cost = 0, cc_input_tokens = 0, cc_output_tokens = 0, cc_sessions = 0
     WHERE report_id = ?`,
    [reportId],
  );

  let matched = 0;
  let unmatched = 0;
  let totalSpendCents = 0;
  for (const [email, data] of byEmail.entries()) {
    totalSpendCents += data.cost;
    const login = emailToLogin.get(email);
    if (!login) { unmatched++; continue; }
    const [result] = await db.execute(
      `UPDATE developer_stats
         SET cc_total_cost = ?, cc_input_tokens = ?, cc_output_tokens = ?, cc_sessions = ?
       WHERE report_id = ? AND github_login = ?`,
      [data.cost, data.inputTokens, data.outputTokens, data.sessions, reportId, login],
    ) as [any, any];
    if (result.affectedRows > 0) matched++;
    else unmatched++;
  }

  // Persist spend period on the report
  await db.execute(
    `UPDATE reports SET cc_period_start = ?, cc_period_end = ? WHERE id = ?`,
    [periodStart, periodEnd, reportId],
  );

  return NextResponse.json({
    matched,
    unmatched,
    totalCsvUsers: byEmail.size,
    totalSpendUsd: totalSpendCents / 100,
    periodStart,
    periodEnd,
  });
}

export const POST = withRequestLog(postHandler);
