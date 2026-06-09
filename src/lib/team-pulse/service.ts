import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import { extractTeamPulseData, extractTeamProjectsData } from './data';
import { buildTeamPulsePrompt } from './prompt';
import { generateTeamProjects } from './projects';
import type { TeamProject } from './types';

const PROMPT_VERSION = 'v4-inflight';

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

export interface TeamPulseOpts {
  /** When true, generate the per-team Current Projects (LLM clustering call).
   *  When false (default), the cache row is stored with projects = NULL and the
   *  API returns projects = [], deferring the LLM call until a caller asks for
   *  projects explicitly. Lets the team page lazy-fetch on card expansion. */
  withProjects?: boolean;
}

export async function getTeamPulse(
  reportId: string,
  teamName: string,
  org: string,
  teamMembers: string[],
  opts: TeamPulseOpts = {},
): Promise<TeamPulseResult> {
  const { withProjects = false } = opts;

  // Check cache
  const [cached] = await db.execute(
    `SELECT summary_text, health_json, projects, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
    [reportId, teamName, PROMPT_VERSION],
  ) as [any[], any];

  if (cached.length > 0) {
    const row = cached[0];
    const health = typeof row.health_json === 'string' ? JSON.parse(row.health_json) : row.health_json;
    let projects: TeamProject[] = [];
    if (row.projects) {
      try {
        projects = typeof row.projects === 'string' ? JSON.parse(row.projects) : row.projects;
        if (!Array.isArray(projects)) projects = [];
      } catch {
        projects = [];
      }
    }

    // Lazy projects top-up: cache row exists but projects is NULL, caller
    // explicitly asked for projects → run the LLM now and update the row.
    if (withProjects && (row.projects === null || row.projects === undefined)) {
      try {
        const projectsInput = await extractTeamProjectsData(reportId, teamMembers);
        projects = await generateTeamProjects(projectsInput, teamName);
        // Only the projects column is being filled — leave generated_at alone
        // so a lazy top-up doesn't look like a fresh pulse regeneration.
        await db.execute(
          `UPDATE team_pulse_summaries
              SET projects = ?
            WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
          [JSON.stringify(projects), reportId, teamName, PROMPT_VERSION],
        );
      } catch (err) {
        console.warn(`[team-pulse] projects lazy-gen failed for team=${teamName}:`, err);
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

  // GLOOK-11: generate per-team Current Projects only if the caller asked for
  // it. Default path leaves projects = NULL in the cache row so the team page
  // can lazy-fetch on demand without paying the LLM cost up front.
  let projects: TeamProject[] = [];
  let projectsForDb: string | null = null;
  if (withProjects) {
    try {
      const projectsInput = await extractTeamProjectsData(reportId, teamMembers);
      projects = await generateTeamProjects(projectsInput, teamName);
      projectsForDb = JSON.stringify(projects);
    } catch (err) {
      console.warn(`[team-pulse] projects generation failed for team=${teamName}:`, err);
      projects = [];
      projectsForDb = JSON.stringify([]);
    }
  }

  // Cache
  // COALESCE on projects: a race where TeamPulseCard fires the no-withProjects
  // path concurrent with an expand-triggered withProjects=true path must NOT
  // clobber a successfully-generated projects value back to NULL.
  await db.execute(
    `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json, projects, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), projects = COALESCE(VALUES(projects), projects), prompt_version = VALUES(prompt_version), generated_at = NOW()`,
    [reportId, teamName, org, summary, JSON.stringify(health), projectsForDb, PROMPT_VERSION],
  );

  return { summary, health, projects, generatedAt: new Date().toISOString(), cached: false };
}
