import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps } from '@/lib/llm-provider';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; login: string }> },
) {
  const { id, login } = await params;

  // Check cache first
  const [cached] = await db.execute(
    `SELECT summary_text, badges_json, generated_at FROM developer_summaries
     WHERE report_id = ? AND github_login = ?`,
    [id, login],
  ) as [any[], any];

  if (cached.length > 0) {
    return NextResponse.json({
      summary: cached[0].summary_text,
      badges: typeof cached[0].badges_json === 'string'
        ? JSON.parse(cached[0].badges_json || '[]')
        : (cached[0].badges_json || []),
      generated_at: cached[0].generated_at,
      cached: true,
    });
  }

  // Gather data for the prompt
  const [reportRows] = await db.execute(
    `SELECT org, period_days FROM reports WHERE id = ?`, [id],
  ) as [any[], any];
  if (!reportRows.length) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  const { org, period_days } = reportRows[0];

  // All devs ordered by impact (for rank + above devs)
  const [allDevs] = await db.execute(
    `SELECT github_login, github_name, total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage, type_breakdown
     FROM developer_stats WHERE report_id = ? ORDER BY impact_score DESC`,
    [id],
  ) as [any[], any];

  const devIdx = allDevs.findIndex((d: any) => d.github_login === login);
  if (devIdx === -1) {
    return NextResponse.json({ error: 'Developer not found' }, { status: 404 });
  }

  const dev = allDevs[devIdx];
  const rank = devIdx + 1;
  const totalDevs = allDevs.length;

  // Devs above (up to 3 positions above)
  const devsAbove = allDevs.slice(Math.max(0, devIdx - 3), devIdx);

  // Get this dev's commits split by recent 7 days vs prior 7 days
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`, [org],
  ) as [any[], any];
  const reportIds = allReportIds.map((r: any) => r.id);

  let allCommits: any[] = [];
  if (reportIds.length > 0) {
    const placeholders = reportIds.map(() => '?').join(',');
    const [rows] = await db.execute(
      `SELECT commit_sha, committed_at, lines_added, lines_removed,
              complexity, type, ai_co_authored, maybe_ai
       FROM commit_analyses
       WHERE github_login = ? AND report_id IN (${placeholders})
       ORDER BY committed_at DESC`,
      [login, ...reportIds],
    ) as [any[], any];
    // Dedup
    const seen = new Set<string>();
    for (const r of rows) {
      if (!seen.has(r.commit_sha)) { seen.add(r.commit_sha); allCommits.push(r); }
    }
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const d14 = new Date(now.getTime() - 14 * 86400000);

  const recent7d = allCommits.filter(c => c.committed_at && new Date(c.committed_at) >= d7);
  const prior7d = allCommits.filter(c => c.committed_at && new Date(c.committed_at) >= d14 && new Date(c.committed_at) < d7);

  function weekStats(commits: any[]) {
    const count = commits.length;
    const lines = commits.reduce((s, c) => s + (Number(c.lines_added) || 0) + (Number(c.lines_removed) || 0), 0);
    const complexities = commits.filter(c => c.complexity != null).map(c => Number(c.complexity));
    const avgC = complexities.length ? (complexities.reduce((s, n) => s + n, 0) / complexities.length) : 0;
    const aiCount = commits.filter(c => c.ai_co_authored || c.maybe_ai).length;
    const aiPct = count > 0 ? Math.round((aiCount / count) * 100) : 0;
    const types: Record<string, number> = {};
    for (const c of commits) { if (c.type) types[c.type] = (types[c.type] || 0) + 1; }
    return { count, lines, avgComplexity: Math.round(avgC * 10) / 10, aiPct, types };
  }

  const recentStats = weekStats(recent7d);
  const priorStats = weekStats(prior7d);

  // Build prompt
  const formatDev = (d: any, anonymous = false) => {
    const prefix = anonymous ? `rank #${d.rank || '?'}` : `@${d.github_login}`;
    return `${prefix}: commits=${d.total_commits}, PRs=${d.total_prs}, lines=${d.lines_added}+/${d.lines_removed}-, complexity=${Number(d.avg_complexity).toFixed(1)}, impact=${Number(d.impact_score).toFixed(1)}, PR%=${d.pr_percentage}, AI%=${d.ai_percentage}`;
  };

  const isTop3 = rank <= 3;
  const rankLabel = rank === 1 ? '1st (top of leaderboard)' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `#${rank} of ${totalDevs}`;

  const systemPrompt = `You are a terse engineering performance coach. Write a developer summary for Glooker (GitHub analytics tool).

Output JSON with two fields:
{ "summary": "markdown text", "badges": [{ "icon": "emoji", "title": "Name", "description": "one-liner" }] }

SUMMARY rules:
- MAX 3 short sentences total. No fluff, no filler.
- Sentence 1: Week-over-week delta (commits, lines, complexity — numbers only, skip if no change)
- Sentence 2: Strongest metric + one tip to climb leaderboard (or legend praise if top 3)
- Sentence 3: AI usage note (only if >0%)
- #1 = "Apex Legend", #2 = "Elite Force", #3 = "Rising Titan" — one sentence of praise, not a paragraph
- NEVER mention other developers by name or login. Use relative references like "the developer above you" or "top 5 average".
- No greetings, no sign-offs, no "keep it up" fluff

BADGES: 2-4 badges max. Be creative but short descriptions (under 8 words).

Return ONLY raw JSON.`;

  const userMessage = `Developer: ${dev.github_name || dev.github_login} (@${dev.github_login})
Rank: ${rankLabel}
Period: ${period_days} days

Overall stats: ${formatDev(dev)}
Types breakdown: ${JSON.stringify(typeof dev.type_breakdown === 'string' ? JSON.parse(dev.type_breakdown || '{}') : (dev.type_breakdown || {}))}

Last 7 days: commits=${recentStats.count}, lines=${recentStats.lines}, avgComplexity=${recentStats.avgComplexity}, AI%=${recentStats.aiPct}, types=${JSON.stringify(recentStats.types)}
Prior 7 days: commits=${priorStats.count}, lines=${priorStats.lines}, avgComplexity=${priorStats.avgComplexity}, AI%=${priorStats.aiPct}, types=${JSON.stringify(priorStats.types)}

${devsAbove.length > 0 ? `Developers ranked above (anonymous, for comparison only):
${devsAbove.map((d, i) => `  ${formatDev({ ...d, rank: rank - devsAbove.length + i }, true)}`).join('\n')}` : 'This developer is #1 — no one above them.'}

Total developers in org: ${totalDevs}`;

  try {
    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.7,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ...extraBodyProps(),
    } as any);

    const content = response.choices[0].message.content;
    const raw = (Array.isArray(content) ? content.join('') : String(content ?? '{}'));
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    let parsed: { summary?: string; badges?: any[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { summary: cleaned, badges: [] };
    }

    const summary = parsed.summary || '';
    const badges = Array.isArray(parsed.badges) ? parsed.badges : [];

    // Save to DB
    await db.execute(
      `INSERT INTO developer_summaries (report_id, github_login, summary_text, badges_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         summary_text = VALUES(summary_text),
         badges_json = VALUES(badges_json),
         generated_at = NOW()`,
      [id, login, summary, JSON.stringify(badges)],
    );

    return NextResponse.json({ summary, badges, generated_at: new Date().toISOString(), cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: `LLM error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
