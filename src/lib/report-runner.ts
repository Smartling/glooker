import pLimit from 'p-limit';
import db from './db/index';
import { getGitHubProvider, getCommitDetail, type CommitData, type OpenPrInfo } from './github';
import { analyzeCommit, type CommitAnalysis } from './analyzer';
import { aggregate, computeImpactScore } from './aggregator';
import { updateProgress, addLog } from './progress-store';
import { getJiraClient } from './jira';
import { resolveJiraUser } from './jira';
import { getAppConfig } from './app-config/service';

import { UNMERGED_LOOKBACK_DAYS } from './report/unmerged-window';
import { refreshCcSpendForReport } from './cc-spend/service';
import { AnthropicAnalyticsKeyMissingError } from './cc-spend/anthropic-provider';
import { IntegrityTracker } from './report-runner/integrity-tracker';
import { loadSkipClassifier, evaluateIntegrity } from './report-runner/skip-classifier';
import { DEFAULT_THRESHOLDS, type RunMetadata } from './report-runner/types';

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
    const github = getGitHubProvider();
    const members = await github.listOrgMembers(org, log);
    updateProgress(reportId, {
      totalRepos: members.length,
      step: `Fetching activity for ${members.length} members...`,
    });

    // GLOOK-13: load skip classifier (allowlist + recent-history) and start the
    // integrity tracker. Both are scoped to this single run.
    const classifySkip = await loadSkipClassifier();
    const integrity = new IntegrityTracker({
      expectedCount: members.length,
      thresholds: DEFAULT_THRESHOLDS,
    });

    // Per-member tracking for pipelined processing
    const memberCommits   = new Map<string, CommitData[]>();   // login → commits from search
    const memberPending   = new Map<string, number>();          // login → in-flight LLM count
    const completedMembers = new Set<string>();                 // fully done members
    const prCounts         = new Map<string, number>();
    const reviewCounts     = new Map<string, number>();
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

      // Attach review counts (already fetched during per-member loop)
      for (const s of memStats) {
        s.totalReviews = reviewCounts.get(s.githubLogin) || 0;
        s.impactScore = computeImpactScore(s);
      }

      // Save developer_stats to DB immediately (progressive)
      for (const s of memStats) {
        log(`DEV @${s.githubLogin}: ${s.totalCommits} commits, ${s.totalPRs} PRs, ${s.totalReviews} reviews, PR%=${s.prPercentage}%, AI%=${s.aiPercentage}%, complexity=${s.avgComplexity}, impact=${s.impactScore}`);
        db.execute(
          `INSERT INTO developer_stats
             (report_id, github_login, github_name, avatar_url,
              total_prs, total_commits, lines_added, lines_removed,
              avg_complexity, impact_score, pr_percentage, ai_percentage,
              total_jira_issues, total_reviews,
              type_breakdown, active_repos)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
             total_reviews    = VALUES(total_reviews),
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
            s.totalReviews,
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
        const activity = await github.fetchUserActivity(org, member.login, since, log);

        if (activity.commits.length > 0 || activity.prs.length > 0) {
          log(`@${member.login}: ${activity.commits.length} commits, ${activity.prs.length} merged PRs`);
          activeMemberCount++;
        }

        prCounts.set(member.login, activity.prs.length);

        // Fetch PR review count (overlaps with LLM work from previous members)
        try {
          const reviews = await github.countReviewedPRs(org, member.login, since);
          reviewCounts.set(member.login, reviews);
          if (reviews > 0) log(`@${member.login}: ${reviews} PRs reviewed`);
        } catch {
          reviewCounts.set(member.login, 0);
        }

        // Fetch open PRs for this member (in-flight metadata, not counted in impact)
        let openPrs: OpenPrInfo[] = [];
        try {
          openPrs = await github.fetchOpenPRs(org, member.login, since, log);
          if (openPrs.length > 0) log(`@${member.login}: ${openPrs.length} open PR(s)`);
          for (const pr of openPrs) {
            await db.execute(
              `INSERT IGNORE INTO unmerged_prs
                 (report_id, github_login, repo, pr_number, pr_title, pr_url,
                  is_draft, pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                reportId, member.login, pr.repo, pr.number, pr.title, pr.url,
                pr.draft ? 1 : 0, pr.commits, pr.additions, pr.deletions, pr.createdAt, pr.updatedAt,
              ],
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`@${member.login} openPRs failed: ${message}`);
          integrity.recordError({ context: 'openPRs', login: member.login, message });
        }

        // Dedup commits against global seen set
        const thisMemCommits: CommitData[] = [];
        for (const c of activity.commits) {
          if (!seen.has(c.sha)) {
            seen.add(c.sha);
            thisMemCommits.push(c);
          }
        }
        memberCommits.set(member.login, thisMemCommits);

        // ── Unmerged commits flow (per-engineer, isolated from main report) ──
        // Build a per-engineer set of unmerged commit SHAs across two sources:
        //   (1) commits in the engineer's open PRs
        //   (2) commits on non-default branches the engineer pushed to (no PR yet)
        // Then enrich each unique SHA with line counts via getCommitDetail.
        try {
          type UmRecord = { repo: string; sha: string; message: string; committedAt: string; branch: string | null; prNumber: number | null };
          const seenSha = new Set<string>();
          const queue: UmRecord[] = [];
          // Cap unmerged-commit fetch at UNMERGED_LOOKBACK_DAYS. Matches the org chart
          // display window (which already clips older weeks), so older commits would
          // never render anyway. Skipping them avoids ~15-20% of the dominant
          // getCommitDetail cost without any visible information loss. Readers in
          // dev.ts/summary.ts/org.ts use the same constant so query windows match.
          const unmergedCutoff = new Date(Date.now() - UNMERGED_LOOKBACK_DAYS * 86400_000);
          const inWindow = (committedAt: string): boolean => {
            const t = new Date(committedAt).getTime();
            return Number.isFinite(t) && t >= unmergedCutoff.getTime();
          };

          // (1) commits in open PRs.
          // Drop commits with null `authorLogin` (rare: signed merge commits, bot
          // authors without GitHub accounts) rather than implicitly attributing
          // them to the engineer being processed. Email-based fallback would be
          // an option but the safer default is to skip — these commits don't
          // belong on the in-flight surface for this engineer.
          for (const pr of openPrs) {
            try {
              const prCommits = await github.fetchPullRequestCommits(org, pr.repo, pr.number, log);
              for (const c of prCommits) {
                if (!c.authorLogin || c.authorLogin !== member.login) continue;
                if (!inWindow(c.committedAt)) continue;
                if (seenSha.has(c.sha)) continue;
                seenSha.add(c.sha);
                queue.push({ repo: pr.repo, sha: c.sha, message: c.message, committedAt: c.committedAt, branch: null, prNumber: pr.number });
              }
            } catch (err) {
              log(`fetchPullRequestCommits failed for ${pr.repo}#${pr.number}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          // (2) commits on orphan branches via per-repo events.
          // We can't use the per-user events feed (fine-grained PATs return 403). Instead,
          // for each repo the engineer is active in, fetch the repo-level events feed
          // (cached per repo across engineers), filter to PushEvents/CreateEvents whose
          // actor is this engineer, and resolve each non-default ref to its head + commits.
          const activeRepos = new Set<string>();
          for (const c of activity.commits) activeRepos.add(c.repo);
          for (const pr of openPrs) activeRepos.add(pr.repo);

          for (const repo of activeRepos) {
            let events: any[] = [];
            try {
              events = await github.fetchRepoEvents(org, repo, log);
            } catch (err) {
              log(`fetchRepoEvents failed for ${repo}: ${err instanceof Error ? err.message : String(err)}`);
              continue;
            }
            const branchSeen = new Set<string>();
            for (const ev of events) {
              if (!ev.actorLogin) continue; // null/empty-actor events (rare bot pushes)
              if (ev.actorLogin !== member.login) continue;
              if (!ev.ref) continue;
              if (branchSeen.has(ev.ref)) continue;
              branchSeen.add(ev.ref);
              try {
                // Always resolve via the live branches API (don't trust the events-feed
                // headSha). If the branch was deleted (e.g., merged + auto-cleanup),
                // the call returns null and we skip — work has moved on. If it was
                // force-pushed, we get the current head, not the historical one.
                const branchName = ev.ref.replace(/^refs\/heads\//, '');
                const headSha = await github.getBranchHeadSha(org, repo, branchName, log);
                if (!headSha) continue;

                const inMain = await github.isCommitInDefaultBranch(org, repo, headSha);
                if (inMain) continue; // already merged — not an orphan branch

                // Catch the squash-merged-but-branch-kept case: branch still exists, head SHA
                // isn't in default (squash created a new SHA there), but the work shipped via
                // a merged PR. Without this, the original branch commits would be re-inserted
                // every report run as fake in-flight.
                if (await github.isShaInMergedPR(org, repo, headSha, log, ({ sha, message }) =>
                  integrity.recordError({ context: 'sha-merge-check', sha, message })
                )) continue;

                const branchCommits = await github.compareBranchCommits(org, repo, headSha, log);
                for (const c of branchCommits) {
                  // See note above on dropping null authorLogin commits — applies here too.
                  if (!c.authorLogin || c.authorLogin !== member.login) continue;
                  if (!inWindow(c.committedAt)) continue;
                  if (seenSha.has(c.sha)) continue;
                  seenSha.add(c.sha);
                  queue.push({ repo, sha: c.sha, message: c.message, committedAt: c.committedAt, branch: branchName, prNumber: null });
                }
              } catch (err) {
                log(`branch compare failed for ${repo}/${ev.ref}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }

          // (3) per-commit line counts + INSERT into unmerged_commits
          for (const item of queue) {
            try {
              const detail = await getCommitDetail(org, item.repo, item.sha, log);
              await db.execute(
                `INSERT IGNORE INTO unmerged_commits
                   (report_id, github_login, repo, branch, pr_number, commit_sha, commit_message,
                    lines_added, lines_removed, committed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  reportId, member.login, item.repo, item.branch, item.prNumber,
                  item.sha, item.message, detail.additions, detail.deletions, item.committedAt,
                ],
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log(`unmerged-commit detail failed for ${item.sha.slice(0, 7)}: ${message}`);
              integrity.recordError({ context: 'unmerged-commit-detail', login: member.login, sha: item.sha, message });
            }
          }
        } catch (err) {
          log(`@${member.login} unmerged-commits flow failed: ${err instanceof Error ? err.message : String(err)}`);
        }

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
        const message = err instanceof Error ? err.message : String(err);
        log(`SKIP @${member.login}: ${message}`);
        integrity.recordSkip(member.login, message, classifySkip(member.login));
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

    // GLOOK-13: evaluate integrity AFTER the gather loop is drained but BEFORE
    // we spend more time on Jira / report aggregation. On 'failed' we still
    // proceed to persist run_metadata (forensics), then short-circuit before
    // marking 'completed'.
    const integritySnapshot = integrity.snapshot();
    const integrityState = evaluateIntegrity(integrity);

    if (integrityState === 'failed') {
      const unknownCount = integritySnapshot.skipped.filter(s => s.classification === 'unknown').length;
      const expectedCount = integritySnapshot.expectedCount;
      const pct = expectedCount > 0 ? Math.round((unknownCount / expectedCount) * 100) : 0;
      const abortReason = `GitHub API degraded: ${unknownCount} of ${expectedCount} engineers couldn't be fetched (${pct}%). Likely upstream auth/permission regression.`;
      log(`ABORT (GLOOK-13): ${abortReason}`);

      const runMetadata: RunMetadata = {
        state: 'failed',
        skipped: integritySnapshot.skipped,
        errors: integritySnapshot.errors,
        expectedCount: integritySnapshot.expectedCount,
        thresholds: integritySnapshot.thresholds,
        abortReason,
      };
      await db.execute(
        `UPDATE reports SET status = 'failed', error = ?, run_metadata = ?, completed_at = NOW() WHERE id = ?`,
        [abortReason, JSON.stringify(runMetadata), reportId],
      );
      updateProgress(reportId, { status: 'failed', step: abortReason });
      return;
    }

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
              mapping.accountId,
              days,
              jiraConfig.projects.length > 0 ? jiraConfig.projects : undefined,
              jiraConfig.storyPointsFields,
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

    // CC spend enrichment — non-fatal. If Anthropic Admin API key is unset or the
    // API is down, the report still completes with cc_* columns left at 0.
    //
    // Resume guard: a resumed run whose original execution already populated
    // cc_period_end means applyCcSpend already ran. Re-invoking would reset
    // cc_total_cost/cc_requests to 0 inside the transaction (visible $0 in the
    // Spend tab for the duration) and burn an Anthropic API pull. Skip and
    // direct the operator to the explicit refresh path.
    const [ccReportRows] = await db.execute(
      `SELECT cc_period_end FROM reports WHERE id = ?`,
      [reportId],
    ) as [any[], any];
    const ccAlreadyPulled = ccReportRows[0]?.cc_period_end != null;

    if (resume && ccAlreadyPulled) {
      log('CC spend: SKIP — already pulled (resume); use Settings → Pull from Anthropic to re-pull');
    } else {
      try {
        log('Pulling Claude Code spend from Anthropic API...');
        const ccResult = await refreshCcSpendForReport(reportId, log);
        const extras: string[] = [];
        if (ccResult.unmappedEmail > 0) extras.push(`${ccResult.unmappedEmail} unmapped`);
        if (ccResult.noDevStatsRow > 0) extras.push(`${ccResult.noDevStatsRow} no commits`);
        const tail = extras.length ? ` [${extras.join(', ')}]` : '';
        log(`CC spend: ${ccResult.matched}/${ccResult.totalApiUsers} matched, $${ccResult.totalSpendUsd.toFixed(2)} total (${ccResult.periodStart} → ${ccResult.periodEnd})${tail}`);
      } catch (err) {
        if (err instanceof AnthropicAnalyticsKeyMissingError) {
          log('CC spend: SKIP — ANTHROPIC_ANALYTICS_API_KEY not set (configure in .env.local or container env)');
        } else {
          log(`CC spend: SKIP — ${err instanceof Error ? err.message : String(err)}`);
        }
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

    // Attach Jira issue counts + story points, then recalculate impact score
    for (const s of stats) {
      if (jiraIssueCountByLogin.has(s.githubLogin)) {
        s.totalJiraIssues = jiraIssueCountByLogin.get(s.githubLogin)!;
      } else {
        const [jiraRows] = await db.execute(
          `SELECT COUNT(*) as cnt FROM jira_issues WHERE report_id = ? AND github_login = ?`,
          [reportId, s.githubLogin],
        ) as [any[], any];
        s.totalJiraIssues = jiraRows[0]?.cnt || 0;
      }

      // Sum story points for this developer
      const [spRows] = await db.execute(
        `SELECT COALESCE(SUM(story_points), 0) as sp FROM jira_issues WHERE report_id = ? AND github_login = ?`,
        [reportId, s.githubLogin],
      ) as [any[], any];
      s.totalStoryPoints = Number(spRows[0]?.sp || 0);

      // Attach review counts (already fetched during per-member loop)
      s.totalReviews = reviewCounts.get(s.githubLogin) || 0;

      // Recalculate impact score with Jira + reviews
      s.impactScore = computeImpactScore(s);
    }

    for (const s of stats) {
      await db.execute(
        `INSERT INTO developer_stats
           (report_id, github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            total_jira_issues, total_reviews,
            type_breakdown, active_repos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           total_reviews     = VALUES(total_reviews),
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
          s.totalReviews,
          JSON.stringify(s.typeBreakdown),
          JSON.stringify(s.activeRepos),
        ],
      );
    }

    // GLOOK-13: persist run_metadata for ok/degraded outcomes too.
    const runMetadata: RunMetadata = {
      state: integrityState,
      skipped: integritySnapshot.skipped,
      errors: integritySnapshot.errors,
      expectedCount: integritySnapshot.expectedCount,
      thresholds: integritySnapshot.thresholds,
    };

    // 4. Mark complete
    await db.execute(
      `UPDATE reports SET status = 'completed', run_metadata = ?, completed_at = NOW() WHERE id = ?`,
      [JSON.stringify(runMetadata), reportId],
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
