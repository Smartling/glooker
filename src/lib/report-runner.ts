import pLimit from 'p-limit';
import db from './db/index';
import { listOrgMembers, fetchUserActivity, type CommitData } from './github';
import { analyzeCommit, type CommitAnalysis } from './analyzer';
import { aggregate } from './aggregator';
import { updateProgress, addLog } from './progress-store';
import { getJiraClient } from './jira';
import { resolveJiraUser } from './jira';
import { getAppConfig } from './app-config/service';

const CONCURRENCY = Number(process.env.LLM_CONCURRENCY || 5);

// Stop signal store (globalThis to survive Next.js HMR)
const g = globalThis as typeof globalThis & { __glooker_stops?: Set<string> };
if (!g.__glooker_stops) g.__glooker_stops = new Set();
const stopRequests = g.__glooker_stops;

export function requestStop(reportId: string): void {
  stopRequests.add(reportId);
}

function shouldStop(reportId: string): boolean {
  return stopRequests.has(reportId);
}

function clearStop(reportId: string): void {
  stopRequests.delete(reportId);
}

export async function runReport(
  reportId:  string,
  org:       string,
  days:      number,
  resume   = false,
  testMode = false,
): Promise<void> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const log = (msg: string) => { addLog(reportId, msg); console.log(`[${reportId.slice(0,8)}] ${msg}`); };

  try {
    await db.execute(
      `UPDATE reports SET status = 'running', error = NULL WHERE id = ?`,
      [reportId],
    );
    updateProgress(reportId, { status: 'running', step: resume ? 'Resuming...' : 'Listing org members...' });
    clearStop(reportId);
    log(`${resume ? 'Resuming' : 'Starting'} report: org=${org}, days=${days}, since=${since.toISOString().split('T')[0]}`);

    // On resume, load already-analyzed commit SHAs from DB
    const existingAnalyses = new Map<string, CommitAnalysis>();
    const existingShas = new Set<string>();
    if (resume) {
      const [rows] = await db.execute(
        `SELECT commit_sha, complexity, type, impact_summary, risk_level, maybe_ai
         FROM commit_analyses WHERE report_id = ? AND complexity IS NOT NULL`,
        [reportId],
      ) as [any[], any];
      for (const row of rows) {
        existingShas.add(row.commit_sha);
        existingAnalyses.set(row.commit_sha, {
          sha:           row.commit_sha,
          complexity:    row.complexity,
          type:          row.type,
          impactSummary: row.impact_summary || '',
          riskLevel:     row.risk_level || 'low',
          maybeAi:       Boolean(row.maybe_ai),
        });
      }
      log(`Resume: found ${existingShas.size} already-analyzed commits in DB`);
    }

    // 1. List org members
    const members = await listOrgMembers(org, log);
    updateProgress(reportId, {
      totalRepos: members.length,
      step: `Fetching activity for ${members.length} members...`,
    });

    // Per-member tracking for pipelined processing
    const memberCommits   = new Map<string, CommitData[]>();   // login → commits from search
    const memberPending   = new Map<string, number>();          // login → in-flight LLM count
    const completedMembers = new Set<string>();                 // fully done members
    const prCounts         = new Map<string, number>();
    const analyses         = new Map<string, CommitAnalysis>(existingAnalyses);
    const seen             = new Set<string>();                 // global dedup
    const pendingLLM: Promise<void>[] = [];
    const limit            = pLimit(CONCURRENCY);
    let llmErrors          = 0;
    let processedMembers   = 0;
    let activeMemberCount  = 0;

    // Helper: check if a member is fully done, then aggregate + save
    function checkMemberComplete(login: string) {
      if (completedMembers.has(login)) return;
      if ((memberPending.get(login) || 0) > 0) return;
      completedMembers.add(login);

      // Aggregate just this member's commits + analyses
      const memCommits = memberCommits.get(login) || [];
      const memPrCounts = new Map<string, number>();
      memPrCounts.set(login, prCounts.get(login) || 0);
      const memStats = aggregate(memCommits, analyses, memPrCounts);

      // Save developer_stats to DB immediately (progressive)
      for (const s of memStats) {
        log(`DEV @${s.githubLogin}: ${s.totalCommits} commits, ${s.totalPRs} PRs, PR%=${s.prPercentage}%, AI%=${s.aiPercentage}%, complexity=${s.avgComplexity}, impact=${s.impactScore}`);
        db.execute(
          `INSERT INTO developer_stats
             (report_id, github_login, github_name, avatar_url,
              total_prs, total_commits, lines_added, lines_removed,
              avg_complexity, impact_score, pr_percentage, ai_percentage,
              total_jira_issues,
              type_breakdown, active_repos)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             total_prs        = VALUES(total_prs),
             total_commits    = VALUES(total_commits),
             lines_added      = VALUES(lines_added),
             lines_removed    = VALUES(lines_removed),
             avg_complexity   = VALUES(avg_complexity),
             impact_score     = VALUES(impact_score),
             pr_percentage    = VALUES(pr_percentage),
             ai_percentage    = VALUES(ai_percentage),
             total_jira_issues = VALUES(total_jira_issues),
             type_breakdown   = VALUES(type_breakdown),
             active_repos     = VALUES(active_repos)`,
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
            s.totalJiraIssues,
            JSON.stringify(s.typeBreakdown),
            JSON.stringify(s.activeRepos),
          ],
        ).catch((err) => log(`DB WARN saving stats for @${login}: ${err}`));
      }

      updateProgress(reportId, { completedDevelopers: completedMembers.size });
    }

    // 2. Pipelined fetch+LLM loop
    for (const member of members) {
      if (shouldStop(reportId)) throw new Error('Stopped by user');
      if (testMode && activeMemberCount >= 3) {
        log(`TEST MODE: stopping after ${activeMemberCount} active members`);
        break;
      }
      processedMembers++;
      updateProgress(reportId, {
        processedRepos: processedMembers,
        step: `[${processedMembers}/${members.length}] Fetching activity: @${member.login}`,
      });

      try {
        const activity = await fetchUserActivity(org, member.login, since, log);

        if (activity.commits.length > 0 || activity.prs.length > 0) {
          log(`@${member.login}: ${activity.commits.length} commits, ${activity.prs.length} merged PRs`);
          activeMemberCount++;
        }

        prCounts.set(member.login, activity.prs.length);

        // Dedup commits against global seen set
        const thisMemCommits: CommitData[] = [];
        for (const c of activity.commits) {
          if (!seen.has(c.sha)) {
            seen.add(c.sha);
            thisMemCommits.push(c);
          }
        }
        memberCommits.set(member.login, thisMemCommits);

        // Queue LLM for commits not already analyzed
        let pendingCount = 0;
        for (const commit of thisMemCommits) {
          if (existingShas.has(commit.sha)) continue; // already analyzed
          pendingCount++;
          memberPending.set(member.login, (memberPending.get(member.login) || 0) + 1);

          const p = limit(async () => {
            if (shouldStop(reportId)) return;
            try {
              const result = await analyzeCommit(commit);
              analyses.set(commit.sha, result);
              const totalAnalyzed = analyses.size;
              if (totalAnalyzed <= 3 || totalAnalyzed % 25 === 0) {
                log(`LLM [${totalAnalyzed}] ${commit.sha.slice(0, 7)} → complexity=${result.complexity}, type=${result.type}, risk=${result.riskLevel}${result.maybeAi ? ' [maybe_ai]' : ''}`);
              }
              // Save to DB immediately (fixes resume)
              await db.execute(
                `INSERT IGNORE INTO commit_analyses
                   (report_id, github_login, author_email, repo, commit_sha, pr_number, pr_title,
                    commit_message, lines_added, lines_removed,
                    complexity, type, impact_summary, risk_level,
                    ai_co_authored, ai_tool_name, maybe_ai, committed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  reportId,
                  commit.author,
                  commit.authorEmail,
                  commit.repo,
                  commit.sha,
                  commit.prNumber,
                  commit.prTitle,
                  commit.message,
                  commit.additions,
                  commit.deletions,
                  result.complexity,
                  result.type,
                  result.impactSummary,
                  result.riskLevel,
                  commit.aiCoAuthored ? 1 : 0,
                  commit.aiToolName,
                  result.maybeAi ? 1 : 0,
                  commit.committedAt,
                ],
              );
            } catch (err) {
              llmErrors++;
              log(`LLM ERROR ${commit.sha.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`);
            }
            // Decrement pending count and check if member is complete
            memberPending.set(member.login, (memberPending.get(member.login) || 1) - 1);
            checkMemberComplete(member.login);
          });
          pendingLLM.push(p);
        }

        // If no new commits needed LLM, member is immediately complete
        if (pendingCount === 0 && thisMemCommits.length > 0) {
          checkMemberComplete(member.login);
        }
      } catch (err) {
        log(`SKIP @${member.login}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // After fetch loop: set totalDevelopers (enables progress bar %)
    const membersWithCommits = [...memberCommits.entries()].filter(([, c]) => c.length > 0).length;
    updateProgress(reportId, {
      totalDevelopers: membersWithCommits,
      step: `Analyzing commits (${completedMembers.size}/${membersWithCommits} developers done)...`,
    });
    log(`Total: ${seen.size} unique commits from ${membersWithCommits} active developers`);

    // Wait for remaining LLM work
    await Promise.all(pendingLLM);

    if (shouldStop(reportId)) throw new Error('Stopped by user');

    log(`LLM analysis complete: ${analyses.size} total, ${llmErrors} failed`);

    // Jira integration: resolve users and fetch done issues
    const jiraConfig = getAppConfig().jira;
    const jiraIssueCountByLogin = new Map<string, number>();

    if (jiraConfig.enabled) {
      const jiraClient = getJiraClient();
      if (jiraClient) {
        log('Starting Jira issue collection...');
        let jiraProcessed = 0;
        const jiraTotal = [...memberCommits.entries()].filter(([, c]) => c.length > 0).length;

        for (const [login, commits] of memberCommits.entries()) {
          if (commits.length === 0) continue;
          if (shouldStop(reportId)) throw new Error('Stopped by user');

          jiraProcessed++;
          updateProgress(reportId, {
            step: `[${jiraProcessed}/${jiraTotal}] Fetching Jira issues: @${login}`,
          });

          // Resume: skip if already have jira_issues for this user/report
          const [existingJira] = await db.execute(
            `SELECT COUNT(*) as cnt FROM jira_issues WHERE report_id = ? AND github_login = ?`,
            [reportId, login],
          ) as [any[], any];

          if (existingJira[0]?.cnt > 0) {
            jiraIssueCountByLogin.set(login, existingJira[0].cnt);
            log(`[jira] @${login}: ${existingJira[0].cnt} issues already in DB (resume)`);
            continue;
          }

          try {
            const mapping = await resolveJiraUser(org, login, reportId, log);
            if (!mapping) {
              jiraIssueCountByLogin.set(login, 0);
              continue;
            }

            const issues = await jiraClient.searchDoneIssues(
              mapping.accountId, days, jiraConfig.projects.length > 0 ? jiraConfig.projects : undefined,
            );

            for (const issue of issues) {
              await db.execute(
                `INSERT IGNORE INTO jira_issues
                   (report_id, github_login, jira_account_id, jira_email,
                    project_key, issue_key, issue_type, summary, description,
                    status, labels, story_points, original_estimate_seconds,
                    issue_url, created_at, resolved_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  reportId, login, mapping.accountId, mapping.email,
                  issue.projectKey, issue.issueKey, issue.issueType,
                  issue.summary, issue.description, issue.status,
                  JSON.stringify(issue.labels), issue.storyPoints,
                  issue.originalEstimateSeconds, issue.issueUrl,
                  issue.createdAt, issue.resolvedAt,
                ],
              );
            }

            jiraIssueCountByLogin.set(login, issues.length);
            if (issues.length > 0) log(`[jira] @${login}: ${issues.length} resolved issues`);
          } catch (err) {
            log(`[jira] ERROR @${login}: ${err instanceof Error ? err.message : String(err)}`);
            jiraIssueCountByLogin.set(login, 0);
          }
        }

        log(`Jira collection complete: ${[...jiraIssueCountByLogin.values()].reduce((a, b) => a + b, 0)} total issues`);
      }
    }

    // 3. Final aggregation with full cross-member view (overwrites per-member stats)
    updateProgress(reportId, { step: 'Final aggregation...', completedDevelopers: membersWithCommits });
    log('Running final aggregation...');

    const allCommits: CommitData[] = [];
    for (const commits of memberCommits.values()) {
      allCommits.push(...commits);
    }
    const stats = aggregate(allCommits, analyses, prCounts);

    // Attach Jira issue counts to aggregated stats
    for (const s of stats) {
      s.totalJiraIssues = jiraIssueCountByLogin.get(s.githubLogin) || 0;
    }

    for (const s of stats) {
      await db.execute(
        `INSERT INTO developer_stats
           (report_id, github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            total_jira_issues,
            type_breakdown, active_repos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           total_prs         = VALUES(total_prs),
           total_commits     = VALUES(total_commits),
           lines_added       = VALUES(lines_added),
           lines_removed     = VALUES(lines_removed),
           avg_complexity    = VALUES(avg_complexity),
           impact_score      = VALUES(impact_score),
           pr_percentage     = VALUES(pr_percentage),
           ai_percentage     = VALUES(ai_percentage),
           total_jira_issues = VALUES(total_jira_issues),
           type_breakdown    = VALUES(type_breakdown),
           active_repos      = VALUES(active_repos)`,
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
          s.totalJiraIssues,
          JSON.stringify(s.typeBreakdown),
          JSON.stringify(s.activeRepos),
        ],
      );
    }

    // 4. Mark complete
    await db.execute(
      `UPDATE reports SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [reportId],
    );
    log(`Report complete: ${stats.length} developers`);
    updateProgress(reportId, { status: 'completed', step: 'Done', totalDevelopers: membersWithCommits, completedDevelopers: membersWithCommits });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isStopped = msg === 'Stopped by user' || shouldStop(reportId);
    const status = isStopped ? 'stopped' : 'failed';
    log(isStopped ? 'Stopped by user' : `FATAL: ${msg}`);
    if (!isStopped) console.error(`Report ${reportId} failed:`, err);
    await db.execute(
      `UPDATE reports SET status = ?, error = ? WHERE id = ?`,
      [status, msg, reportId],
    ).catch(console.error);
    updateProgress(reportId, { status, step: isStopped ? 'Stopped' : 'Failed', error: msg });
    clearStop(reportId);
  }
}
