import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import { extractTeamPulseData, extractTeamProjectsData } from './data';
import { buildTeamPulsePrompt } from './prompt';
import { generateTeamProjects } from './projects';
import type { TeamProject } from './types';

const PROMPT_VERSION = 'v2-inflight';

export interface TeamPulseResult {
  summary: string;
  health: {
    activeRatio: string;
    trending: string;
    trendDirection: 'up' | 'down' | 'stable';
  };
  projects: TeamProject[];      // NEW (GLOOK-11)
  generatedAt: string;
  cached: boolean;
}

export async function getTeamPulse(
  reportId: string,
  teamName: string,
  org: string,
  teamMembers: string[],
): Promise<TeamPulseResult> {
  // Check cache
  const [cached] = await db.execute(
    `SELECT summary_text, health_json, projects, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
    [reportId, teamName, PROMPT_VERSION],
  ) as [any[], any];

  if (cached.length > 0) {
    const row = cached[0];
    const health = typeof row.health_json === 'string' ? JSON.parse(row.health_json) : row.health_json;
    // projects column is nullable on legacy rows — coerce to [] so the
    // API contract is stable; the card will render empty in that case.
    let projects: TeamProject[] = [];
    if (row.projects) {
      try {
        projects = typeof row.projects === 'string' ? JSON.parse(row.projects) : row.projects;
        if (!Array.isArray(projects)) projects = [];
      } catch {
        projects = [];
      }
    }
    return {
      summary: row.summary_text,
      health,
      projects,
      generatedAt: row.generated_at,
      cached: true,
    };
  }

  // Get report end date
  const [reportRows] = await db.execute(
    `SELECT created_at, period_days FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!reportRows.length) throw new Error('Report not found');
  const reportEndDate = new Date(reportRows[0].created_at);

  // Extract data
  const data = await extractTeamPulseData(reportId, teamMembers, reportEndDate);
  data.teamName = teamName;

  // Build prompt
  const vars = JSON.parse(buildTeamPulsePrompt(data));
  const systemPrompt = loadPrompt('team-pulse-system.txt', vars);

  // Call LLM
  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.5,
    ...tokenLimit(1024),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the team pulse summary based on the data provided in the system prompt.' },
    ],
    ...extraBodyProps(),
    ...promptTag('team-pulse-system'),
  } as any);

  const raw = response.choices[0]?.message?.content || '';
  const summary = (Array.isArray(raw) ? raw.join('') : String(raw)).trim();

  // Build health indicators
  const health = {
    activeRatio: `${data.activeCount}/${data.totalCount}`,
    trending: `${data.trendingPct >= 0 ? '+' : ''}${data.trendingPct}%`,
    trendDirection: data.trendDirection,
  };

  // GLOOK-11: generate per-team Current Projects using the full report window.
  let projects: TeamProject[] = [];
  try {
    const projectsInput = await extractTeamProjectsData(reportId, teamMembers);
    projects = await generateTeamProjects(projectsInput);
  } catch (err) {
    // Don't fail the whole pulse if projects gen fails — log and continue with [].
    console.warn(`[team-pulse] projects generation failed for team=${teamName}:`, err);
    projects = [];
  }

  // Cache
  await db.execute(
    `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json, projects, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), projects = VALUES(projects), prompt_version = VALUES(prompt_version), generated_at = NOW()`,
    [reportId, teamName, org, summary, JSON.stringify(health), JSON.stringify(projects), PROMPT_VERSION],
  );

  return { summary, health, projects, generatedAt: new Date().toISOString(), cached: false };
}
