// scripts/verify-bare-branch.ts
// Runs the unmerged-commits flow for ONE engineer in ONE repo against the live GitHub API
// and prints what WOULD be inserted into the unmerged_commits table.
// Doesn't write to the DB. Faster than running a full report — useful for verifying
// the new fetchRepoEvents path catches a known test commit.
//
// Run: npx tsx scripts/verify-bare-branch.ts
// Env: requires GITHUB_TOKEN in .env.local (or env)

import * as fs from 'fs';
import * as path from 'path';

// Manually load .env.local (no dotenv dependency).
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import {
  fetchRepoEvents,
  getBranchHeadSha,
  isCommitInDefaultBranch,
  compareBranchCommits,
  fetchOpenPRs,
  fetchPullRequestCommits,
  getCommitDetail,
} from '../src/lib/github';

const ORG = 'Smartling';
const USER = 'msogin';
const REPO = 'glooker';

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN missing. Add it to .env.local or set it in env.');
    process.exit(1);
  }

  const log = (m: string) => console.log(`[log] ${m}`);
  console.log(`Verifying unmerged-commits flow for @${USER} in ${ORG}/${REPO}\n`);

  // Match the runner's 90-day cutoff so this script's output mirrors what would
  // actually be inserted into unmerged_commits.
  const unmergedCutoff = new Date(Date.now() - 90 * 86400_000);
  const inWindow = (committedAt: string): boolean => {
    const t = new Date(committedAt).getTime();
    return Number.isFinite(t) && t >= unmergedCutoff.getTime();
  };

  // ── Step 1: open PRs in this repo by msogin ──
  console.log('── 1. fetchOpenPRs (msogin\'s open PRs across the org) ──');
  const since = new Date(Date.now() - 14 * 86400_000);
  const openPrs = await fetchOpenPRs(ORG, USER, since, log);
  const prsInThisRepo = openPrs.filter(p => p.repo === REPO);
  console.log(`  ${openPrs.length} open PRs total, ${prsInThisRepo.length} in ${REPO}`);
  for (const pr of prsInThisRepo) console.log(`    #${pr.number}  ${pr.title}  (${pr.commits} commits, +${pr.additions}/-${pr.deletions})`);

  // ── Step 2: per-repo events feed ──
  console.log(`\n── 2. fetchRepoEvents for ${ORG}/${REPO} ──`);
  const events = await fetchRepoEvents(ORG, REPO, log);
  const myEvents = events.filter(e => e.actorLogin === USER);
  console.log(`  ${events.length} total events, ${myEvents.length} by @${USER}`);

  // ── Step 3: filter to non-default refs and resolve heads ──
  console.log('\n── 3. filter to non-default refs by msogin, resolve heads ──');
  const branchSeen = new Set<string>();
  const queue: Array<{ repo: string; sha: string; message: string; committedAt: string; branch: string; prNumber: number | null; lines_added?: number; lines_removed?: number }> = [];
  const seenSha = new Set<string>();

  for (const ev of myEvents) {
    if (!ev.ref) continue;
    if (branchSeen.has(ev.ref)) continue;
    branchSeen.add(ev.ref);
    const branchName = ev.ref.replace(/^refs\/heads\//, '');

    // Always resolve via live branches API (don't trust events-feed historical head).
    // If the branch was deleted (e.g., merged + auto-cleanup), skip — work has moved on.
    const headSha = await getBranchHeadSha(ORG, REPO, branchName, log);
    if (!headSha) {
      console.log(`  ${ev.type}  ref=${ev.ref}  branch deleted on origin → SKIP`);
      continue;
    }
    console.log(`  ${ev.type}  ref=${ev.ref}  live head=${headSha.slice(0,8)}`);

    const inMain = await isCommitInDefaultBranch(ORG, REPO, headSha);
    if (inMain) { console.log(`    ↳ in default branch — skipping`); continue; }

    const branchCommits = await compareBranchCommits(ORG, REPO, headSha, log);
    console.log(`    ↳ branch is ahead of default; ${branchCommits.length} commits in branch not in default`);
    for (const c of branchCommits) {
      if (c.authorLogin && c.authorLogin !== USER) continue;
      if (!inWindow(c.committedAt)) continue;
      if (seenSha.has(c.sha)) continue;
      seenSha.add(c.sha);
      queue.push({ repo: REPO, sha: c.sha, message: c.message, committedAt: c.committedAt, branch: branchName, prNumber: null });
    }
  }

  // ── Step 4: open-PR commits for msogin's PRs in this repo ──
  console.log(`\n── 4. fetchPullRequestCommits for msogin's PRs in ${REPO} ──`);
  for (const pr of prsInThisRepo) {
    const prCommits = await fetchPullRequestCommits(ORG, REPO, pr.number, log);
    for (const c of prCommits) {
      if (c.authorLogin && c.authorLogin !== USER) continue;
      if (!inWindow(c.committedAt)) continue;
      if (seenSha.has(c.sha)) continue;
      seenSha.add(c.sha);
      queue.push({ repo: REPO, sha: c.sha, message: c.message, committedAt: c.committedAt, branch: '', prNumber: pr.number });
    }
    console.log(`  PR #${pr.number}: ${prCommits.length} commits`);
  }

  // ── Step 5: per-commit line counts ──
  console.log(`\n── 5. getCommitDetail for ${queue.length} unique unmerged commits ──`);
  for (const item of queue) {
    try {
      const detail = await getCommitDetail(ORG, REPO, item.sha, log);
      item.lines_added = detail.additions;
      item.lines_removed = detail.deletions;
    } catch (err) {
      console.log(`  detail failed for ${item.sha.slice(0,8)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Final: WOULD-BE-INSERTED rows ──
  console.log('\n══════════ WOULD INSERT INTO unmerged_commits ══════════');
  if (queue.length === 0) console.log('  (none — flow returned nothing)');
  for (const item of queue) {
    const tag = item.prNumber ? `PR#${item.prNumber}` : `branch=${item.branch}`;
    const flag = item.sha.startsWith('ed336dee') ? '  ★ TEST COMMIT' : '';
    console.log(`  sha=${item.sha.slice(0,8)}  ${tag.padEnd(28)}  +${item.lines_added}/-${item.lines_removed}  ${item.committedAt}  ${item.message.split('\n')[0].slice(0,50)}${flag}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
