import { Octokit } from '@octokit/rest';

export interface CommitData {
  sha:           string;
  repo:          string;
  author:        string;
  authorName:    string;
  authorEmail:   string;
  avatarUrl:     string;
  message:       string;      // first line
  fullMessage:   string;      // full commit message (for trailer parsing)
  diff:          string;
  additions:     number;
  deletions:     number;
  prNumber:      number | null;  // null = direct push
  prTitle:       string | null;
  committedAt:   string;
  aiCoAuthored:  boolean;     // detected AI co-author trailer
  aiToolName:    string | null; // e.g. "Claude Code", "Cursor", "GitHub Copilot"
}

export interface PRInfo {
  number:   number;
  title:    string;
  repo:     string;
  mergedAt: string;
}

export interface OpenPrInfo {
  repo:       string;
  number:     number;
  title:      string;
  url:        string;
  draft:      boolean;
  commits:    number;
  additions:  number;
  deletions:  number;
  createdAt:  string;
  updatedAt:  string;
}

export interface RepoEvent {
  type:        'PushEvent' | 'CreateEvent';
  actorLogin:  string;
  ref:         string;          // 'refs/heads/feature-foo'
  headSha:     string | null;    // null for CreateEvent — resolve via getBranchHeadSha
  createdAt:   string;
}

export interface UnmergedCommitInfo {
  sha:          string;
  message:      string;
  authorLogin:  string | null;
  committedAt:  string;
}

export interface OrgMember {
  login:     string;
  avatarUrl: string;
}

export interface UserActivity {
  commits: CommitData[];
  prs:     PRInfo[];
}

export interface GitHubProvider {
  listOrgMembers(org: string, log?: (msg: string) => void): Promise<OrgMember[]>;
  fetchUserActivity(org: string, user: string, since: Date, log?: (msg: string) => void): Promise<UserActivity>;
  listOrgs(): Promise<Array<{ login: string; avatar_url: string }>>;
  countReviewedPRs(org: string, user: string, since: Date): Promise<number>;
  fetchOpenPRs(org: string, user: string, since: Date, log?: (msg: string) => void): Promise<OpenPrInfo[]>;
  isCommitInDefaultBranch(owner: string, repo: string, sha: string): Promise<boolean>;
  fetchRepoEvents(owner: string, repo: string, log?: (msg: string) => void): Promise<RepoEvent[]>;
  getBranchHeadSha(owner: string, repo: string, branchName: string, log?: (msg: string) => void): Promise<string | null>;
  fetchPullRequestCommits(owner: string, repo: string, pullNumber: number, log?: (msg: string) => void): Promise<UnmergedCommitInfo[]>;
  compareBranchCommits(owner: string, repo: string, headSha: string, log?: (msg: string) => void): Promise<UnmergedCommitInfo[]>;
  isShaInMergedPR(owner: string, repo: string, sha: string, log?: (msg: string) => void, onError?: (info: { sha: string; message: string }) => void): Promise<boolean>;
}

let octokit: InstanceType<typeof Octokit> | null = null;
let octokitOverride: InstanceType<typeof Octokit> | null = null;

export function __setOctokitForTest(mock: any) {
  octokitOverride = mock;
}

function getOctokit(): InstanceType<typeof Octokit> {
  if (octokitOverride) return octokitOverride;
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}

// ---------- Rate limit helpers ----------

const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);
const TRANSIENT_MAX_ATTEMPTS = 3;
const TRANSIENT_BACKOFF_MS = [1000, 2000, 4000]; // attempt 1, 2, 3

const TOTAL_MAX_ATTEMPTS = 12; // hard cap across all error types (5xx/429/network mix)

/** Base wait for a secondary (abuse-detection) rate limit, before exponential growth. */
const SECONDARY_BASE_SEC = 60;
/** Cap on a single secondary wait, so one unrecoverable call cannot stall a run for an hour. */
const SECONDARY_MAX_SEC = 300;
/** Floor for a primary-limit wait derived from x-ratelimit-reset. */
const PRIMARY_FLOOR_SEC = 10;
/** Base for the primary schedule when a 429 carries no usable headers at all. */
const PRIMARY_FALLBACK_BASE_SEC = 30;

/**
 * GitHub renamed "abuse detection mechanism" to "secondary rate limit" but
 * still emits the old wording on some endpoints, so both must match.
 */
const SECONDARY_PHRASES = /secondary rate limit|abuse detection mechanism/i;
/** Any 403 that names a rate limit is one, even when the headers are missing. */
const RATE_LIMIT_PHRASES = /rate limit|abuse detection mechanism/i;

interface GitHubErrorLike {
  status?: number;
  message?: string;
  response?: {
    status?: number;
    headers?: Record<string, unknown>;
    data?: { message?: string };
  };
}

function statusOf(err: unknown): number | undefined {
  const e = err as GitHubErrorLike | null | undefined;
  return e?.status ?? e?.response?.status;
}

function headersOf(err: unknown): Record<string, unknown> {
  const e = err as GitHubErrorLike | null | undefined;
  return e?.response?.headers ?? {};
}

/**
 * Both message carriers, concatenated rather than `??`-chained. Octokit's
 * RequestError always sets `.message`, so a `??` chain makes
 * `response.data.message` unreachable — and that is the carrier a non-Octokit
 * caller or a raw fetch surfaces.
 */
function messageOf(err: unknown): string {
  const e = err as GitHubErrorLike | null | undefined;
  return `${e?.message ?? ''} ${e?.response?.data?.message ?? ''}`;
}

/**
 * Is this 403/429 a rate limit at all?
 *
 * 429 always is. A 403 is only a rate limit when GitHub says so — via
 * `retry-after`, the wording, or an exhausted primary quota. Everything else
 * with a 403 is a permission condition (SSO/SAML enforcement, missing scope,
 * `Resource not accessible by integration`) that no amount of waiting fixes;
 * those propagate immediately the way 404 already does, instead of burning the
 * whole retry budget on a deterministic failure.
 */
export function isRateLimitError(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 429) return true;
  if (status !== 403) return false;

  const h = headersOf(err);
  if (h['retry-after'] !== undefined) return true;
  if (RATE_LIMIT_PHRASES.test(messageOf(err))) return true;
  return String(h['x-ratelimit-remaining']) === '0';
}

/**
 * GitHub has two rate limits and they need different backoffs.
 *
 * The primary limit is quota-based: `/rate_limit` reports it and responses
 * carry `x-ratelimit-reset`, so waiting until that reset is exactly right.
 *
 * The secondary (abuse-detection) limit is in neither. During the 2026-09-02
 * incident the search quota read 30/30 while search calls were being rejected.
 * Treating that as a primary limit meant deriving the wait from
 * `x-ratelimit-reset` — the *healthy* primary window — so the wait collapsed to
 * the 10s floor and the retry immediately re-tripped the same limit.
 *
 * Detection is structural first and textual second. GitHub's own documented
 * algorithm discriminates on remaining quota, not on prose: a rate-limited
 * response with primary quota left cannot be a primary limit, whatever the
 * message says. Relying on the wording alone left the original bug one
 * rewording away from returning.
 */
export function isSecondaryRateLimit(err: unknown): boolean {
  if (!isRateLimitError(err)) return false;
  if (SECONDARY_PHRASES.test(messageOf(err))) return true;

  const remaining = headersOf(err)['x-ratelimit-remaining'];
  return remaining !== undefined && String(remaining) !== '0';
}

/**
 * RFC 7231 allows `Retry-After` to be delta-seconds or an HTTP-date; GitHub
 * sends delta-seconds. Returns null when absent or unparseable so the caller
 * falls through to a real schedule instead of inventing a number — the previous
 * `Number(raw) || 60` turned `retry-after: 0` into a 60s wait and an HTTP-date
 * into `NaN || 60`.
 */
function parseRetryAfter(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const sec = Number(raw);
  if (Number.isFinite(sec)) return Math.max(sec, 0);
  const at = Date.parse(String(raw));
  if (Number.isFinite(at)) return Math.max(Math.ceil((at - Date.now()) / 1000), 0);
  return null;
}

/** How long to wait before retrying a rate-limited GitHub call. */
export function rateLimitWaitSeconds(
  err: unknown,
  attempt: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  const h = headersOf(err);
  const secondary = isSecondaryRateLimit(err);
  const secondarySchedule = Math.min(SECONDARY_BASE_SEC * Math.pow(2, attempt), SECONDARY_MAX_SEC);

  const asked = parseRetryAfter(h['retry-after']);
  if (asked !== null) {
    // Never retry earlier than GitHub asked. On a secondary limit keep the
    // escalation as well: GitHub routinely sends retry-after on abuse-detection
    // 403s, and returning it flat meant every one of the 5 attempts waited the
    // same 60s, re-tripping the limit at the boundary — the same no-growth shape
    // as the bug this fixes.
    return secondary ? Math.max(asked, secondarySchedule) : asked;
  }

  // Deliberately ignore x-ratelimit-reset here: it describes the primary window.
  if (secondary) return secondarySchedule;

  const resetEpoch = h['x-ratelimit-reset'];
  if (resetEpoch !== undefined) {
    const reset = Number(resetEpoch);
    if (Number.isFinite(reset)) return Math.max(reset - nowSec, PRIMARY_FLOOR_SEC);
  }
  return PRIMARY_FALLBACK_BASE_SEC * Math.pow(2, attempt);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  log?: (msg: string) => void,
  maxRetries = 5,
): Promise<T> {
  let transientAttempt = 0;
  let totalAttempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      totalAttempts++;
      if (totalAttempts > TOTAL_MAX_ATTEMPTS) throw err;

      const status = err?.status || err?.response?.status;
      const networkCode = err?.code as string | undefined;
      const isRateLimit = isRateLimitError(err);
      const is5xx = typeof status === 'number' && status >= 500 && status < 600;
      const isNetwork = !!networkCode && NETWORK_ERROR_CODES.has(networkCode);

      // 1. Rate limit — primary waits until x-ratelimit-reset, secondary escalates
      //    60s→300s. A 403 that is NOT a rate limit falls through to case 3.
      if (isRateLimit) {
        if (attempt === maxRetries) throw err;
        const secondary = isSecondaryRateLimit(err);
        const waitSec = rateLimitWaitSeconds(err, attempt);
        const kind = secondary ? 'Secondary rate limit' : 'Rate limited';
        log?.(`${kind} (attempt ${attempt + 1}/${maxRetries}). Waiting ${waitSec}s…`);
        await sleep(waitSec * 1000);
        continue;
      }

      // 2. Transient 5xx + network — shallow shared budget (3 attempts × ≤4s)
      if (is5xx || isNetwork) {
        if (transientAttempt >= TRANSIENT_MAX_ATTEMPTS) throw err;
        const waitMs = TRANSIENT_BACKOFF_MS[transientAttempt] ?? 4000;
        const label = is5xx ? `HTTP ${status}` : `network ${networkCode}`;
        log?.(`Transient ${label} (attempt ${transientAttempt + 1}/${TRANSIENT_MAX_ATTEMPTS}). Retrying in ${waitMs}ms…`);
        await sleep(waitMs);
        transientAttempt++;
        attempt--; // transient retries don't consume the rate-limit budget
        continue;
      }

      // 3. Everything else (404, 401, validation errors, …) — propagate immediately.
      // 404 is the deterministic signal the threshold logic depends on.
      throw err;
    }
  }
  throw new Error('withRetry: unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- AI co-author detection ----------

const AI_PATTERNS: Array<{ pattern: RegExp; tool: string }> = [
  { pattern: /Co-Authored-By:.*\bClaude\b/i,            tool: 'Claude Code' },
  { pattern: /Co-Authored-By:.*\bCursor\b/i,            tool: 'Cursor' },
  { pattern: /Co-Authored-By:.*\bGitHub Copilot\b/i,    tool: 'GitHub Copilot' },
  { pattern: /Co-Authored-By:.*\bCopilot\b/i,           tool: 'GitHub Copilot' },
  { pattern: /Co-Authored-By:.*\bWindsurf\b/i,          tool: 'Windsurf' },
  { pattern: /Co-Authored-By:.*\bAider\b/i,             tool: 'Aider' },
  { pattern: /Co-Authored-By:.*\bCodeium\b/i,           tool: 'Codeium' },
  { pattern: /Co-Authored-By:.*\bTabnine\b/i,           tool: 'Tabnine' },
  { pattern: /Co-Authored-By:.*\bAmazon Q\b/i,          tool: 'Amazon Q' },
  { pattern: /Co-Authored-By:.*noreply@anthropic/i,      tool: 'Claude Code' },
  { pattern: /Co-Authored-By:.*noreply@cursor/i,         tool: 'Cursor' },
  { pattern: /Generated with \[?Claude Code\]?/i,        tool: 'Claude Code' },
  { pattern: /Generated by Copilot/i,                    tool: 'GitHub Copilot' },
];

export function detectAiCoAuthor(fullMessage: string): { detected: boolean; tool: string | null } {
  for (const { pattern, tool } of AI_PATTERNS) {
    if (pattern.test(fullMessage)) {
      return { detected: true, tool };
    }
  }
  return { detected: false, tool: null };
}

// ---------- Org members ----------

export async function listOrgMembers(
  org: string,
  log?: (msg: string) => void,
): Promise<OrgMember[]> {
  const members: OrgMember[] = [];
  const kit = getOctokit();
  for await (const res of kit.paginate.iterator(kit.orgs.listMembers, {
    org, per_page: 100,
  })) {
    members.push(...res.data.map((m) => ({
      login:     m.login,
      avatarUrl: m.avatar_url || '',
    })));
  }
  log?.(`Found ${members.length} org members`);
  return members;
}

// ---------- Per-user commit search ----------

interface RawCommitHit {
  sha:         string;
  repo:        string;
  message:     string;   // first line
  fullMessage: string;   // complete message
  authorLogin: string;
  authorName:  string;
  authorEmail: string;
  avatarUrl:   string;
  date:        string;
}

/**
 * Search all commits by a user in an org within a date range.
 * Uses the commit search API — gives the complete picture including
 * direct pushes that never went through a PR.
 */
async function searchUserCommits(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<RawCommitHit[]> {
  const sinceStr = since.toISOString().split('T')[0];
  const query    = `org:${org} author:${user} committer-date:>=${sinceStr}`;
  const hits: RawCommitHit[] = [];

  let page = 1;
  while (true) {
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().search.commits({
        q: query, sort: 'committer-date', order: 'desc', per_page: 100, page,
      }),
      log,
    );

    for (const item of res.data.items) {
      hits.push({
        sha:         item.sha,
        repo:        item.repository.name,
        message:     item.commit.message.split('\n')[0],
        fullMessage: item.commit.message,
        authorLogin: item.author?.login       || user,
        authorName:  item.commit.author?.name  || user,
        authorEmail: item.commit.author?.email || '',
        avatarUrl:   item.author?.avatar_url   || '',
        date:        item.commit.committer?.date || '',
      });
    }

    if (hits.length >= res.data.total_count || res.data.items.length < 100) break;
    page++;
  }
  return hits;
}

// ---------- Per-user PR search ----------

async function searchUserMergedPRs(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<PRInfo[]> {
  const sinceStr = since.toISOString().split('T')[0];
  const query    = `org:${org} type:pr is:merged author:${user} merged:>=${sinceStr}`;
  const prs: PRInfo[] = [];

  let page = 1;
  while (true) {
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().search.issuesAndPullRequests({
        q: query, sort: 'updated', order: 'desc', per_page: 100, page,
      }),
      log,
    );
    if (page === 1 && res.data.total_count === 0) return [];

    for (const item of res.data.items) {
      const repoFullName = item.repository_url.split('/repos/')[1] || '';
      const repo = repoFullName.split('/')[1] || '';
      prs.push({
        number:   item.number,
        title:    item.title,
        repo,
        mergedAt: item.pull_request?.merged_at || '',
      });
    }
    if (prs.length >= res.data.total_count || res.data.items.length < 100) break;
    page++;
  }
  return prs;
}

// ---------- Commit detail (diff) ----------

export async function getCommitDetail(
  org:  string,
  repo: string,
  sha:  string,
  log?: (msg: string) => void,
): Promise<{ additions: number; deletions: number; diff: string }> {
  const { data } = await withRetry(
    () => getOctokit().repos.getCommit({ owner: org, repo, ref: sha }),
    log,
  );
  const additions = data.stats?.additions || 0;
  const deletions = data.stats?.deletions || 0;
  const patches = (data.files || [])
    .map((f) => `--- ${f.filename}\n${f.patch || ''}`)
    .join('\n');
  return { additions, deletions, diff: patches.slice(0, 4000) };
}

// ---------- Main: fetch full user activity ----------

/**
 * Fetches complete activity for a user: all commits + merged PRs.
 * Commits are enriched with diffs and matched to PRs where possible.
 */
export async function fetchUserActivity(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<UserActivity> {
  // 1. Get all commits and merged PRs in parallel-ish (with rate limit gaps)
  const rawCommits = await searchUserCommits(org, user, since, log);
  const prs        = await searchUserMergedPRs(org, user, since, log);

  // 2. Build PR lookup: repo#number → PRInfo
  //    Also parse PR refs from commit messages: "(#123)"
  const prByKey = new Map<string, PRInfo>();
  for (const pr of prs) {
    prByKey.set(`${pr.repo}#${pr.number}`, pr);
  }

  // 3. Enrich each commit with diff and PR association
  const commits: CommitData[] = [];

  // Cache PR bodies fetched for AI detection on merge commits
  const prBodyCache = new Map<string, string>();

  for (const raw of rawCommits) {
    // Try to match commit to a PR via message pattern "(#NNN)" or "Merge pull request #NNN"
    const prMatch = raw.message.match(/\(#(\d+)\)/) || raw.message.match(/^Merge pull request #(\d+)/);
    let prNumber: number | null = null;
    let prTitle:  string | null = null;

    if (prMatch) {
      const key = `${raw.repo}#${prMatch[1]}`;
      const pr  = prByKey.get(key);
      if (pr) {
        prNumber = pr.number;
        prTitle  = pr.title;
      } else {
        // PR ref in message but not in our PR search — still mark it
        prNumber = Number(prMatch[1]);
      }
    }

    // Detect AI co-author from full commit message
    let ai = detectAiCoAuthor(raw.fullMessage);

    // For merge commits with a PR: also check PR body and branch commit trailers
    if (!ai.detected && prNumber && raw.message.startsWith('Merge pull request #')) {
      const cacheKey = `${raw.repo}#${prNumber}`;
      let prBody = prBodyCache.get(cacheKey);
      if (prBody === undefined) {
        try {
          const { data: prData } = await withRetry(
            () => getOctokit().pulls.get({ owner: org, repo: raw.repo, pull_number: prNumber! }),
            log,
          );
          prBody = prData.body || '';
          prBodyCache.set(cacheKey, prBody);
        } catch {
          prBody = '';
          prBodyCache.set(cacheKey, prBody);
        }
      }
      if (prBody) {
        ai = detectAiCoAuthor(prBody);
      }

      // If still not detected, check the branch commits' trailers
      if (!ai.detected) {
        try {
          const { data: prCommits } = await withRetry(
            () => getOctokit().pulls.listCommits({ owner: org, repo: raw.repo, pull_number: prNumber!, per_page: 50 }),
            log,
          );
          for (const pc of prCommits) {
            const branchAi = detectAiCoAuthor(pc.commit.message);
            if (branchAi.detected) {
              ai = branchAi;
              break;
            }
          }
        } catch {
          // proceed without branch commit check
        }
      }
    }

    // Fetch diff
    let diff = '', additions = 0, deletions = 0;
    try {
      const detail = await getCommitDetail(org, raw.repo, raw.sha, log);
      diff      = detail.diff;
      additions = detail.additions;
      deletions = detail.deletions;
    } catch {
      // proceed without diff
    }

    commits.push({
      sha:          raw.sha,
      repo:         raw.repo,
      author:       raw.authorLogin,
      authorName:   raw.authorName,
      authorEmail:  raw.authorEmail,
      avatarUrl:    raw.avatarUrl,
      message:      raw.message,
      fullMessage:  raw.fullMessage,
      diff,
      additions,
      deletions,
      prNumber,
      prTitle,
      committedAt:  raw.date,
      aiCoAuthored: ai.detected,
      aiToolName:   ai.tool,
    });
  }

  // 4. Second pass: for commits without PR association, check GitHub's "pulls for commit" API
  const unmatchedCommits = commits.filter(c => c.prNumber === null);
  if (unmatchedCommits.length > 0) {
    if (unmatchedCommits.length > 200) {
      log?.(`PR lookup: skipping — ${unmatchedCommits.length} unmatched commits exceeds limit of 200`);
    } else {
    for (const commit of unmatchedCommits) {
      try {
        await sleep(1000); // lighter rate limiting for this secondary lookup
        const response: any = await withRetry(
          () => (getOctokit() as any).repos.listPullRequestsAssociatedWithCommit({
            owner: org,
            repo: commit.repo,
            commit_sha: commit.sha,
            per_page: 1,
          }),
          log,
        );
        const pullsForCommit = response.data || [];
        if (pullsForCommit.length > 0) {
          const pr = pullsForCommit[0];
          commit.prNumber = pr.number;
          commit.prTitle = pr.title;
        }
      } catch {
        // proceed without PR association
      }
    }
    const matched = unmatchedCommits.filter(c => c.prNumber !== null).length;
    if (matched > 0) {
      log?.(`PR lookup: matched ${matched}/${unmatchedCommits.length} commits to PRs`);
    }
    }
  }

  return { commits, prs };
}

// ---------- Org listing ----------

export async function listOrgs(): Promise<Array<{ login: string; avatar_url: string }>> {
  const kit = getOctokit();
  const orgs: Array<{ login: string; avatar_url: string }> = [];
  for await (const res of kit.paginate.iterator(kit.orgs.listForAuthenticatedUser, { per_page: 100 })) {
    orgs.push(...res.data.map((o: any) => ({ login: o.login, avatar_url: o.avatar_url || '' })));
  }
  return orgs;
}

// ---------- PR review count ----------

async function countReviewedPRs(org: string, user: string, since: Date): Promise<number> {
  const sinceStr = since.toISOString().split('T')[0];
  const q = `org:${org} is:pr is:merged reviewed-by:${user} merged:>${sinceStr}`;
  await sleep(2500);
  const res = await withRetry(
    () => getOctokit().search.issuesAndPullRequests({ q, per_page: 1 }),
  );
  return res.data.total_count;
}

// ---------- Open PR search ----------

export async function fetchOpenPRs(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<OpenPrInfo[]> {
  const sinceStr = since.toISOString().split('T')[0];
  const q = `org:${org} author:${user} is:pr is:open updated:>=${sinceStr}`;
  const results: OpenPrInfo[] = [];

  let page = 1;
  while (true) {
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().search.issuesAndPullRequests({ q, per_page: 100, page }),
      log,
    );
    for (const item of res.data.items) {
      // repository_url is `https://api.github.com/repos/{owner}/{repo}`. Use the
      // explicit `/repos/` split rather than `pop()` so a missing/malformed URL
      // produces an empty string we can detect and skip, instead of inserting a
      // row with `repo: ''` that the dev page can't link.
      const repoFullName = (item.repository_url || '').split('/repos/')[1] || '';
      const repo = repoFullName.split('/')[1] || '';
      if (!repo) continue;
      let commits = 0, additions = 0, deletions = 0;
      try {
        const { data: prDetail } = await withRetry(
          () => getOctokit().pulls.get({ owner: org, repo, pull_number: item.number }),
          log,
        );
        commits   = prDetail.commits   ?? 0;
        additions = prDetail.additions ?? 0;
        deletions = prDetail.deletions ?? 0;
      } catch {
        // degrade gracefully if PR details are unavailable
      }
      results.push({
        repo,
        number:    item.number,
        title:     item.title,
        url:       item.html_url,
        draft:     Boolean(item.draft),
        commits,
        additions,
        deletions,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      });
    }
    if (results.length >= res.data.total_count || res.data.items.length < 100) break;
    // GitHub Search caps results at 1000 (10 pages of 100). Without this guard,
    // total_count > 1000 would loop forever.
    if (page >= 10) break;
    page++;
  }

  return results;
}

// ---------- Repo events feed ----------
// Per-repo events. Returns Push and Create-branch events with actor info.
// Replaces the broken `fetchUserOrgEvents` (per-user feed isn't accessible to fine-grained PATs).
// Cached per (owner, repo) for the run lifetime so multiple engineers active in the
// same repo don't re-fetch.

const repoEventsCache = new Map<string, RepoEvent[]>();

export async function fetchRepoEvents(
  owner: string,
  repo:  string,
  log?:  (msg: string) => void,
): Promise<RepoEvent[]> {
  const key = `${owner}/${repo}`;
  if (repoEventsCache.has(key)) return repoEventsCache.get(key)!;

  const events: RepoEvent[] = [];
  for (let page = 1; page <= 3; page++) { // 300 events / 3 pages
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().activity.listRepoEvents({ owner, repo, per_page: 100, page }),
      log,
    );
    for (const item of res.data) {
      const actorLogin = item.actor?.login || '';
      const payload: any = item.payload || {};
      if (item.type === 'PushEvent') {
        if (!payload.ref || !payload.head) continue;
        events.push({
          type: 'PushEvent',
          actorLogin,
          ref: payload.ref,
          headSha: payload.head,
          createdAt: item.created_at || '',
        });
      } else if (item.type === 'CreateEvent' && payload.ref_type === 'branch') {
        const fullRef = payload.full_ref || (payload.ref ? `refs/heads/${payload.ref}` : '');
        if (!fullRef) continue;
        events.push({
          type: 'CreateEvent',
          actorLogin,
          ref: fullRef,
          headSha: null, // CreateEvent doesn't carry the head SHA — caller resolves via getBranchHeadSha
          createdAt: item.created_at || '',
        });
      }
    }
    if (res.data.length < 100) break;
  }

  repoEventsCache.set(key, events);
  return events;
}

// Test-only: clear repoEventsCache. Prefer __clearAllCachesForTest in new tests
// so a future cache addition (e.g. defaultBranchCache below) is also cleared.
export function __clearRepoEventsCacheForTest() {
  repoEventsCache.clear();
}

// Test-only: clear every module-global cache used by github.ts. Wire this into
// `afterEach` for any test exercising github helpers, so cross-test state never
// leaks (e.g. one test seeding `acme/auth` events; the next test asserting an
// empty fetch with the same key would silently get the cached array).
export function __clearAllCachesForTest() {
  repoEventsCache.clear();
  defaultBranchCache.clear();
}

// ---------- Branch head lookup (used to resolve head SHA for CreateEvent) ----------

export async function getBranchHeadSha(
  owner: string,
  repo:  string,
  branchName: string,
  log?:  (msg: string) => void,
): Promise<string | null> {
  try {
    const { data } = await withRetry(
      () => getOctokit().repos.getBranch({ owner, repo, branch: branchName }),
      log,
    );
    return data.commit?.sha || null;
  } catch {
    return null;
  }
}

// ---------- PR commits list ----------

export async function fetchPullRequestCommits(
  owner: string,
  repo:  string,
  pullNumber: number,
  log?:  (msg: string) => void,
): Promise<UnmergedCommitInfo[]> {
  const result: UnmergedCommitInfo[] = [];
  for (let page = 1; page <= 3; page++) { // GitHub caps PR commits at 250
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().pulls.listCommits({ owner, repo, pull_number: pullNumber, per_page: 100, page }),
      log,
    );
    for (const c of res.data) {
      result.push({
        sha:          c.sha,
        message:      c.commit?.message || '',
        authorLogin:  c.author?.login ?? null,
        committedAt:  c.commit?.committer?.date || c.commit?.author?.date || '',
      });
    }
    if (res.data.length < 100) break;
  }
  return result;
}

// ---------- Default branch membership check ----------

// Per-run cache of default branch names keyed by "owner/repo".
const defaultBranchCache = new Map<string, string>();

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const key = `${owner}/${repo}`;
  if (defaultBranchCache.has(key)) return defaultBranchCache.get(key)!;
  const { data } = await withRetry(() => getOctokit().repos.get({ owner, repo }));
  const name = data.default_branch || 'main';
  defaultBranchCache.set(key, name);
  return name;
}

export async function isCommitInDefaultBranch(
  owner: string,
  repo:  string,
  sha:   string,
): Promise<boolean> {
  const base = await getDefaultBranch(owner, repo);
  const { data } = await withRetry(() =>
    getOctokit().repos.compareCommits({ owner, repo, base, head: sha }),
  );
  return data.status === 'behind' || data.status === 'identical';
}

export async function compareBranchCommits(
  owner:   string,
  repo:    string,
  headSha: string,
  log?:    (msg: string) => void,
): Promise<UnmergedCommitInfo[]> {
  const base = await getDefaultBranch(owner, repo);
  const { data } = await withRetry(
    () => getOctokit().repos.compareCommits({ owner, repo, base, head: headSha }),
    log,
  );
  const commits = data.commits || [];
  // GitHub returns up to 250 commits in `data.commits` even if `data.behind_by`
  // is larger. Long-lived feature branches > 250 commits ahead silently truncate.
  // Log so the operator can see this happen; pagination via compareCommitsWithBasehead
  // would be the proper fix when it matters.
  if (commits.length === 250) {
    log?.(`compareBranchCommits: ${owner}/${repo} ${headSha.slice(0, 8)} hit 250-commit cap (branch may be further ahead)`);
  }
  return commits.map((c: any) => ({
    sha:         c.sha,
    message:     c.commit?.message || '',
    authorLogin: c.author?.login ?? null,
    committedAt: c.commit?.committer?.date || c.commit?.author?.date || '',
  }));
}

// Returns true if any PR containing this commit has been merged.
// Used to filter out squash-merged-but-branch-kept refs from the in-flight set.
//
// On error we log and return false so the caller continues, but a transient
// failure (e.g. 5xx after withRetry exhausts) means this report run treats
// the SHA as not-merged and re-inserts pre-squash commits as bogus in-flight
// work. The log line makes that regression mode visible to operators.
export async function isShaInMergedPR(
  owner: string,
  repo:  string,
  sha:   string,
  log?:  (msg: string) => void,
  onError?: (info: { sha: string; message: string }) => void,
): Promise<boolean> {
  try {
    const res: any = await withRetry(
      () => (getOctokit() as any).repos.listPullRequestsAssociatedWithCommit({
        owner, repo, commit_sha: sha,
      }),
      log,
    );
    return (res?.data || []).some((pr: any) => pr.merged_at != null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.(`isShaInMergedPR: ${owner}/${repo} ${sha.slice(0, 8)} failed (${message}); treating as not-merged`);
    onError?.({ sha, message });
    return false;
  }
}

// ---------- Provider factory ----------

let cachedProvider: GitHubProvider | null = null;

export function getGitHubProvider(): GitHubProvider {
  if (cachedProvider) return cachedProvider;

  if (process.env.GITHUB_PROVIDER === 'mock') {
    const { createMockGitHubProvider } = require('./github-mock');
    cachedProvider = createMockGitHubProvider();
    return cachedProvider!;
  }

  cachedProvider = {
    listOrgMembers,
    fetchUserActivity,
    listOrgs,
    countReviewedPRs,
    fetchOpenPRs,
    isCommitInDefaultBranch,
    fetchRepoEvents,
    getBranchHeadSha,
    fetchPullRequestCommits,
    compareBranchCommits,
    isShaInMergedPR,
  };
  return cachedProvider;
}
