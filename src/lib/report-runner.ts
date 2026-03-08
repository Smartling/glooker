import pLimit from 'p-limit';
import db from './db';
import { listOrgMembers, fetchUserActivity, type CommitData } from './github';
import { analyzeCommit, type CommitAnalysis } from './analyzer';
import { aggregate } from './aggregator';
import { updateProgress, addLog } from './progress-store';

const CONCURRENCY = Number(process.env.LLM_CONCURRENCY || 5);

export async function runReport(
  reportId: string,
  org:      string,
  days:     number,
): Promise<void> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const log = (msg: string) => { addLog(reportId, msg); console.log(`[${reportId.slice(0,8)}] ${msg}`); };

  try {
    await db.execute(
      `UPDATE reports SET status = 'running' WHERE id = ?`,
      [reportId],
    );
    updateProgress(reportId, { status: 'running', step: 'Listing org members…' });
    log(`Starting report: org=${org}, days=${days}, since=${since.toISOString().split('T')[0]}`);

    // 1. List org members
    const members = await listOrgMembers(org, log);
    updateProgress(reportId, {
      totalRepos: members.length,  // reusing as "total members"
      step: `Fetching activity for ${members.length} members…`,
    });

    // 2. For each member: search commits + PRs, fetch diffs
    const allCommits: CommitData[] = [];
    const prCounts = new Map<string, number>(); // login → PR count
    let processedMembers = 0;

    for (const member of members) {
      processedMembers++;
      updateProgress(reportId, {
        processedRepos: processedMembers,
        step: `[${processedMembers}/${members.length}] Fetching activity: @${member.login}`,
      });

      try {
        const activity = await fetchUserActivity(org, member.login, since, log);

        if (activity.commits.length > 0 || activity.prs.length > 0) {
          log(`@${member.login}: ${activity.commits.length} commits, ${activity.prs.length} merged PRs`);
        }

        allCommits.push(...activity.commits);
        prCounts.set(member.login, activity.prs.length);
      } catch (err) {
        log(`SKIP @${member.login}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Deduplicate commits (same SHA can appear if commit is in multiple search results)
    const seen = new Set<string>();
    const uniqueCommits = allCommits.filter((c) => {
      if (seen.has(c.sha)) return false;
      seen.add(c.sha);
      return true;
    });

    const activeDevs = new Set(uniqueCommits.map((c) => c.author));
    log(`Total: ${uniqueCommits.length} unique commits from ${activeDevs.size} active developers`);

    updateProgress(reportId, {
      totalCommits: uniqueCommits.length,
      step: `Analyzing ${uniqueCommits.length} commits with LLM (concurrency: ${CONCURRENCY})…`,
    });

    // 3. LLM analysis with concurrency limit
    log(`Starting LLM analysis: ${uniqueCommits.length} commits, concurrency=${CONCURRENCY}`);
    const limit     = pLimit(CONCURRENCY);
    const analyses  = new Map<string, CommitAnalysis>();
    let   analyzed  = 0;
    let   llmErrors = 0;

    await Promise.all(
      uniqueCommits.map((commit) =>
        limit(async () => {
          try {
            const result = await analyzeCommit(commit);
            analyses.set(commit.sha, result);
            if (analyzed < 3 || analyzed % 25 === 0) {
              log(`LLM [${analyzed + 1}/${uniqueCommits.length}] ${commit.sha.slice(0, 7)} → complexity=${result.complexity}, type=${result.type}, risk=${result.riskLevel}`);
            }
          } catch (err) {
            llmErrors++;
            log(`LLM ERROR ${commit.sha.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`);
          }
          analyzed++;
          updateProgress(reportId, { analyzedCommits: analyzed });
        }),
      ),
    );

    log(`LLM analysis complete: ${analyses.size} succeeded, ${llmErrors} failed`);

    // 4. Save individual commit analyses
    log('Saving commit analyses to database…');
    for (const commit of uniqueCommits) {
      const analysis = analyses.get(commit.sha);
      await db.execute(
        `INSERT IGNORE INTO commit_analyses
           (report_id, github_login, repo, commit_sha, pr_number, pr_title,
            commit_message, lines_added, lines_removed,
            complexity, type, impact_summary, risk_level,
            ai_co_authored, ai_tool_name, maybe_ai, committed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId,
          commit.author,
          commit.repo,
          commit.sha,
          commit.prNumber,
          commit.prTitle,
          commit.message,
          commit.additions,
          commit.deletions,
          analysis?.complexity   ?? null,
          analysis?.type         ?? null,
          analysis?.impactSummary ?? null,
          analysis?.riskLevel    ?? null,
          commit.aiCoAuthored ? 1 : 0,
          commit.aiToolName,
          analysis?.maybeAi ? 1 : 0,
          commit.committedAt,
        ],
      );
    }

    // 5. Aggregate and save developer stats
    updateProgress(reportId, { step: 'Aggregating developer stats…' });
    log('Aggregating developer stats…');
    const stats = aggregate(uniqueCommits, analyses, prCounts);

    for (const s of stats) {
      log(`DEV @${s.githubLogin}: ${s.totalCommits} commits, ${s.totalPRs} PRs, PR%=${s.prPercentage}%, AI%=${s.aiPercentage}%, complexity=${s.avgComplexity}, impact=${s.impactScore}`);
      await db.execute(
        `INSERT INTO developer_stats
           (report_id, github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            type_breakdown, active_repos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           total_prs      = VALUES(total_prs),
           total_commits  = VALUES(total_commits),
           lines_added    = VALUES(lines_added),
           lines_removed  = VALUES(lines_removed),
           avg_complexity = VALUES(avg_complexity),
           impact_score   = VALUES(impact_score),
           pr_percentage  = VALUES(pr_percentage),
           ai_percentage  = VALUES(ai_percentage),
           type_breakdown = VALUES(type_breakdown),
           active_repos   = VALUES(active_repos)`,
        [
          reportId,
          s.githubLogin,
          s.githubName,
          s.avatarUrl,
          s.totalPRs,
          s.totalCommits,
          s.linesAdded,
          s.linesRemoved,
          s.avgComplexity,
          s.impactScore,
          s.prPercentage,
          s.aiPercentage,
          JSON.stringify(s.typeBreakdown),
          JSON.stringify(s.activeRepos),
        ],
      );
    }

    // 6. Mark complete
    await db.execute(
      `UPDATE reports SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [reportId],
    );
    log(`Report complete: ${stats.length} developers`);
    updateProgress(reportId, { status: 'completed', step: 'Done' });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`FATAL: ${msg}`);
    console.error(`Report ${reportId} failed:`, err);
    await db.execute(
      `UPDATE reports SET status = 'failed', error = ? WHERE id = ?`,
      [msg, reportId],
    ).catch(console.error);
    updateProgress(reportId, { status: 'failed', step: 'Failed', error: msg });
  }
}
