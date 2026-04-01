import db from '../db/index';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '../llm-provider';
import { loadPrompt } from '../prompt-loader';
import { getAppConfig } from '../app-config/service';

export async function getReportHighlights() {
  // 1. Find the latest completed report
  const [latestRows] = await db.execute(
    `SELECT id, org, period_days, created_at FROM reports
     WHERE status = 'completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [],
  ) as [any[], any];

  if (!latestRows.length) {
    return { available: false };
  }

  const latest = latestRows[0];

  // 2. Find the most recent completed report with same org + period, older than latest
  const [prevRows] = await db.execute(
    `SELECT id, org, period_days, created_at FROM reports
     WHERE status = 'completed' AND org = ? AND period_days = ? AND id != ?
     ORDER BY completed_at DESC LIMIT 1`,
    [latest.org, latest.period_days, latest.id],
  ) as [any[], any];

  if (!prevRows.length) {
    return { available: false };
  }

  const prev = prevRows[0];
  // report_id_a = older, report_id_b = newer
  const reportIdA = prev.id;
  const reportIdB = latest.id;

  // 3. Check cache
  const [cached] = await db.execute(
    `SELECT highlights_json, generated_at FROM report_comparisons
     WHERE report_id_a = ? AND report_id_b = ?`,
    [reportIdA, reportIdB],
  ) as [any[], any];

  if (cached.length > 0) {
    const highlights = typeof cached[0].highlights_json === 'string'
      ? JSON.parse(cached[0].highlights_json)
      : cached[0].highlights_json;
    return {
      available: true,
      org: latest.org,
      periodDays: latest.period_days,
      reportDateA: prev.created_at,
      reportDateB: latest.created_at,
      highlights,
      cached: true,
    };
  }

  // 4. Load dev stats for both reports
  const [statsA] = await db.execute(
    `SELECT github_login, github_name, total_commits, total_prs, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage
     FROM developer_stats WHERE report_id = ? ORDER BY impact_score DESC`,
    [reportIdA],
  ) as [any[], any];

  const [statsB] = await db.execute(
    `SELECT github_login, github_name, total_commits, total_prs, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage
     FROM developer_stats WHERE report_id = ? ORDER BY impact_score DESC`,
    [reportIdB],
  ) as [any[], any];

  // Compute deltas
  const mapA = new Map(statsA.map((d: any, i: number) => [d.github_login, { ...d, rank: i + 1 }]));
  const mapB = new Map(statsB.map((d: any, i: number) => [d.github_login, { ...d, rank: i + 1 }]));

  const allLogins = new Set([...mapA.keys(), ...mapB.keys()]);
  const newDevs = [...allLogins].filter(l => !mapA.has(l) && mapB.has(l));
  const inactiveDevs = [...allLogins].filter(l => mapA.has(l) && !mapB.has(l));

  const formatDev = (d: any) =>
    `@${d.github_login} (rank #${d.rank}): commits=${d.total_commits}, PRs=${d.total_prs}, complexity=${Number(d.avg_complexity).toFixed(1)}, impact=${Number(d.impact_score).toFixed(1)}, AI%=${d.ai_percentage}`;

  const totalA = {
    devs: statsA.length,
    commits: statsA.reduce((s: number, d: any) => s + d.total_commits, 0),
    prs: statsA.reduce((s: number, d: any) => s + d.total_prs, 0),
    avgComplexity: statsA.length ? (statsA.reduce((s: number, d: any) => s + Number(d.avg_complexity), 0) / statsA.length).toFixed(1) : '0',
    avgAi: statsA.length ? Math.round(statsA.reduce((s: number, d: any) => s + d.ai_percentage, 0) / statsA.length) : 0,
  };
  const totalB = {
    devs: statsB.length,
    commits: statsB.reduce((s: number, d: any) => s + d.total_commits, 0),
    prs: statsB.reduce((s: number, d: any) => s + d.total_prs, 0),
    avgComplexity: statsB.length ? (statsB.reduce((s: number, d: any) => s + Number(d.avg_complexity), 0) / statsB.length).toFixed(1) : '0',
    avgAi: statsB.length ? Math.round(statsB.reduce((s: number, d: any) => s + d.ai_percentage, 0) / statsB.length) : 0,
  };

  // Top movers (biggest impact score change)
  const movers = [...allLogins]
    .filter(l => mapA.has(l) && mapB.has(l))
    .map(l => {
      const a = mapA.get(l)!;
      const b = mapB.get(l)!;
      return { login: l, name: b.github_name || l, rankA: a.rank, rankB: b.rank, impactDelta: Number(b.impact_score) - Number(a.impact_score) };
    })
    .sort((a, b) => Math.abs(b.impactDelta) - Math.abs(a.impactDelta))
    .slice(0, 5);

  const systemPrompt = loadPrompt('report-highlights-system.txt');

  const newDevsSection = newDevs.length > 0 ? `\nNew developers: ${newDevs.map(l => '@' + l).join(', ')}` : '';
  const inactiveDevsSection = inactiveDevs.length > 0 ? `\nRecently inactive (no commits in latest report): ${inactiveDevs.map(l => '@' + l).join(', ')}` : '';

  const userMessage = loadPrompt('report-highlights-user.txt', {
    ORG: latest.org,
    PERIOD_DAYS: String(latest.period_days),
    PREV_DATE: String(prev.created_at),
    TOTALS_A: `${totalA.devs} devs, ${totalA.commits} commits, ${totalA.prs} PRs, avgComplexity=${totalA.avgComplexity}, avgAI=${totalA.avgAi}%`,
    TOP5_A: statsA.slice(0, 5).map(formatDev).join('\n  '),
    LATEST_DATE: String(latest.created_at),
    TOTALS_B: `${totalB.devs} devs, ${totalB.commits} commits, ${totalB.prs} PRs, avgComplexity=${totalB.avgComplexity}, avgAI=${totalB.avgAi}%`,
    TOP5_B: statsB.slice(0, 5).map(formatDev).join('\n  '),
    MOVERS: movers.map(m => `@${m.login}: rank ${m.rankA}→${m.rankB}, impact ${m.impactDelta > 0 ? '+' : ''}${m.impactDelta.toFixed(1)}`).join(', '),
    NEW_DEVS_SECTION: newDevsSection,
    INACTIVE_DEVS_SECTION: inactiveDevsSection,
  });

  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: getAppConfig().highlights.temperature,
    ...tokenLimit(getAppConfig().highlights.maxTokens),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    ...extraBodyProps(),
    ...promptTag('report-highlights-system'),
  } as any);

  const raw = response.choices[0].message.content || '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  let parsed: { highlights?: any[] };
  try { parsed = JSON.parse(cleaned); } catch { parsed = { highlights: [] }; }

  const highlights = Array.isArray(parsed.highlights) ? parsed.highlights : [];

  // Save to DB
  await db.execute(
    `INSERT INTO report_comparisons (report_id_a, report_id_b, highlights_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE highlights_json = VALUES(highlights_json), generated_at = NOW()`,
    [reportIdA, reportIdB, JSON.stringify(highlights)],
  );

  return {
    available: true,
    org: latest.org,
    periodDays: latest.period_days,
    reportDateA: prev.created_at,
    reportDateB: latest.created_at,
    highlights,
    cached: false,
  };
}
