import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag, samplingParams } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import { extractTeamPulseData, extractTeamProjectsData } from './data';
import { buildTeamPulsePrompt } from './prompt';
import { generateTeamProjects, TeamProjectsUnusableError } from './projects';
import type { TeamProject } from './types';

// Bumped for GLOOK-51.
//
// Read carefully before relying on this for invalidation: prompt_version is in
// the SELECT key below but NOT in the table's unique key, which is
// `(report_id, team_name)` only. So a bump makes the read miss and the code
// regenerate, but the upsert lands on the SAME physical row. Left to the
// ordinary `COALESCE(VALUES(projects), projects)` that guards the concurrency
// race, a bump therefore preserves a poisoned `'[]'` while stamping the new
// version — permanently blank, now under a version that claims to have fixed
// it. The upsert below handles this explicitly; do not simplify it back.
const PROMPT_VERSION = 'v5-budget';

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
        const result = await generateTeamProjects(projectsInput, teamName);
        projects = result.projects;
        if (result.cacheable) {
          // Only the projects column is being filled — leave generated_at alone
          // so a lazy top-up doesn't look like a fresh pulse regeneration.
          await db.execute(
            `UPDATE team_pulse_summaries
                SET projects = ?
              WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
            [JSON.stringify(projects), reportId, teamName, PROMPT_VERSION],
          );
        }
      } catch (err) {
        // Only OUR failure class is treated as transient. Anything else — a
        // TypeError in the enrichment loop, a DB outage inside
        // extractTeamProjectsData — propagates to the route's 500, because
        // "leave NULL and retry" turns a deterministic bug into an unbounded
        // paid retry that nobody ever sees.
        if (!(err instanceof TeamProjectsUnusableError)) throw err;
        // No write: the column stays NULL so the next load tries again.
        // Persisting this as [] is what made GLOOK-51 permanent.
        console.warn(`[team-pulse] projects lazy-gen unusable for team=${teamName}:`, err.message);
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
    ...samplingParams(0.5),
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
      const result = await generateTeamProjects(projectsInput, teamName);
      projects = result.projects;
      // NULL when not cacheable. Persisting an unusable empty is what made
      // GLOOK-51 permanent: the lazy top-up only re-runs on NULL, so the
      // failure became indistinguishable from a team that genuinely has no
      // projects. A real empty IS still cached, so the page doesn't pay for
      // the LLM on every view.
      projectsForDb = result.cacheable ? JSON.stringify(projects) : null;
    } catch (err) {
      if (!(err instanceof TeamProjectsUnusableError)) throw err;
      console.warn(`[team-pulse] projects generation unusable for team=${teamName}:`, err.message);
      projects = [];
      projectsForDb = null;
    }
  }

  // Cache
  //
  // COALESCE on projects: a race where TeamPulseCard fires the no-withProjects
  // path concurrent with an expand-triggered withProjects=true path must NOT
  // clobber a successfully-generated projects value back to NULL.
  //
  // The CASE around it is what makes a PROMPT_VERSION bump actually invalidate.
  // prompt_version is not in the unique key, so a bump alone would leave the
  // COALESCE preserving a stale (possibly poisoned) projects value on the same
  // row. When the version differs we take the incoming value verbatim —
  // including NULL — so the row reverts to "not yet generated" and the lazy
  // top-up regenerates it. `VALUES(col)` is rewritten to `excluded.col` by
  // translateSQL, so this works on SQLite too (db/sqlite.ts).
  await db.execute(
    `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json, projects, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), projects = CASE WHEN VALUES(prompt_version) <> prompt_version THEN VALUES(projects) ELSE COALESCE(VALUES(projects), projects) END, prompt_version = VALUES(prompt_version), generated_at = NOW()`,
    [reportId, teamName, org, summary, JSON.stringify(health), projectsForDb, PROMPT_VERSION],
  );

  return { summary, health, projects, generatedAt: new Date().toISOString(), cached: false };
}
