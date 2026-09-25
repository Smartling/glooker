import { Octokit } from '@octokit/rest';
import type {
  VulnerabilitySource, FetchedAlert, FetchedRepo, RepoAlertStatus, OnDataNotice,
  RawPropertyRow, FetchedPropertiesResult, PropertyKeys,
} from './vulnerabilities/types';
import { toIsoSecond } from './vulnerabilities/time';
import { mapPropertyRows } from './vulnerabilities/properties';

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

/**
 * A shortfall between what GitHub's search counted and what it delivered.
 *
 * Distinct from a SKIP on purpose. A SKIP means we have nothing trustworthy for
 * this member; a shortfall means we have real data that is known to be short.
 * Throwing the good data away would be worse than `main` on both axes — less
 * data AND more pressure on the GLOOK-13 abort gate — so it is kept and
 * reported through IntegrityError, the "member-kept partial-data" channel the
 * runner already uses for openPRs.
 */
export interface SearchShortfall {
  expected:  number;
  collected: number;
  detail:    string;
}

export interface UserActivity {
  commits: CommitData[];
  prs:     PRInfo[];
  /** Set when the commit search delivered fewer commits than it counted. */
  commitsShortfall?: SearchShortfall;
  /**
   * Set when the merged-PR count could not be verified — the search timed out
   * on an empty result. The zero is kept (it is usually correct) and the
   * uncertainty is recorded, rather than skipping the member outright.
   */
  prsUnverified?: string;
}

export interface GitHubProvider extends VulnerabilitySource {
  listOrgMembers(org: string, log?: (msg: string) => void): Promise<OrgMember[]>;
  fetchUserActivity(org: string, user: string, since: Date, log?: (msg: string) => void): Promise<UserActivity>;
  listOrgs(): Promise<Array<{ login: string; avatar_url: string }>>;
  countReviewedPRs(org: string, user: string, since: Date, log?: (msg: string) => void): Promise<{ reviews: number; unverified?: string }>;
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

// ---------- Search-response accounting (GLOOK-50) ----------

interface SearchAccounting {
  total_count?: number;
  incomplete_results?: boolean;
  items?: unknown[];
}

/**
 * Is this search response one whose emptiness we must NOT trust?
 *
 * Two shapes qualify:
 *
 *  1. `incomplete_results: true` — the query timed out server-side and GitHub
 *     returned only the matches it had found by then, which may be none. So an
 *     empty page with this flag set is an unreliable zero, not a real one.
 *     GitHub publishes no remedy for the flag, and explicitly warns that
 *     "reaching a timeout does not necessarily mean that search results are
 *     incomplete" — so `true` is a reason to distrust a zero, not proof of loss.
 *
 *  2. `total_count > 0` with an empty `items` array — the response contradicts
 *     itself. It needs no interpretation to reject.
 *
 * On 2026-09-08 six developers were recorded with 0 commits while GitHub held
 * 21, 15, 9, 8, 5 and 2 for them (60 commits). No request failed, so nothing
 * was skipped and the integrity guard never saw it. Neither of these fields was
 * read or logged, which is why the cause could not be established afterwards.
 */
export function isSuspectSearchResult(data: SearchAccounting): boolean {
  return isUntrustworthyEmpty(data) || isContradictoryPage(data);
}

/**
 * GitHub timed out before finding anything, so this zero means "did not
 * finish", not "nothing exists". The 2026-09-08 losses were all this shape.
 *
 * Note it requires items to be empty. A timed-out page that still delivered
 * items is NOT flagged here: GitHub warns a timeout "does not necessarily mean
 * that search results are incomplete", and on the run that produced this code
 * 5 of 6 flagged pages were fine. Under-delivery of a *non-empty* page is
 * caught by the total_count reconciliation at the end of collectCommits
 * instead, which is exact rather than advisory.
 */
function isUntrustworthyEmpty(data: SearchAccounting): boolean {
  return data.incomplete_results === true && (data.items?.length ?? 0) === 0;
}

/** The response counts matches but delivered none of them. Incoherent. */
function isContradictoryPage(data: SearchAccounting): boolean {
  return (data.total_count ?? 0) > 0 && (data.items?.length ?? 0) === 0;
}

/**
 * Record the accounting fields of a search response.
 *
 * SUSPECT marks only the shapes collectCommits actually acts on, so the log
 * line and the retry decision cannot drift apart.
 */
function logSearchAccounting(
  label: string,
  user: string,
  page: number,
  data: SearchAccounting,
  log?: (msg: string) => void,
): void {
  const items = data.items?.length ?? 0;
  const total = data.total_count ?? -1;
  const suspect = isSuspectSearchResult(data);
  const line =
    `[search] ${label} @${user} page=${page} items=${items} total_count=${total} ` +
    `incomplete_results=${data.incomplete_results === true}` +
    (suspect ? ' SUSPECT' : '');

  // The progress store keeps only the last 200 lines, and four unconditional
  // lines per member (264 for a 66-member org) would evict an early SUSPECT
  // from the surface an operator opens first. So the interesting lines go to
  // the run log, and the routine ones only to stdout.
  if (suspect || (total >= 0 && items !== total)) log?.(line);
  else console.log(line);
}

/** GitHub serves at most 1000 results for a search, however large total_count is. */
const SEARCH_RESULT_CAP = 1000;
const SEARCH_PER_PAGE = 100;
/** Extra attempts at the same page before we stop believing an untrustworthy answer. */
const SEARCH_TIMEOUT_RETRIES = 2;
const SEARCH_TIMEOUT_RETRY_MS = 5000;
/** How many times a window may be halved before we give up and raise. */
const MAX_WINDOW_SPLIT_DEPTH = 2;

/**
 * The date clause for a commit search.
 *
 * A null `to` keeps the original open-ended `>=` form, so the un-split query is
 * byte-identical to what shipped before and a clock-skewed future committer
 * date is still matched.
 */
function commitDateClause(from: Date, to: Date | null): string {
  const f = from.toISOString().split('T')[0];
  if (!to) return `committer-date:>=${f}`;
  return `committer-date:${f}..${to.toISOString().split('T')[0]}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Halve a date window, keeping the second half's upper bound open if it was.
 * Returns null when the window is too small for splitting to buy anything.
 */
export function splitDateWindow(
  from: Date,
  to: Date | null,
  now: Date = new Date(),
): [{ from: Date; to: Date | null }, { from: Date; to: Date | null }] | null {
  const end = to ?? now;
  const spanDays = Math.floor((end.getTime() - from.getTime()) / DAY_MS);
  if (spanDays < 2) return null;
  const mid = new Date(from.getTime() + Math.floor(spanDays / 2) * DAY_MS);
  return [
    { from, to: mid },
    { from: new Date(mid.getTime() + DAY_MS), to },
  ];
}

function toRawHit(item: any, user: string): RawCommitHit {
  return {
    sha:         item.sha,
    repo:        item.repository.name,
    message:     item.commit.message.split('\n')[0],
    fullMessage: item.commit.message,
    authorLogin: item.author?.login       || user,
    authorName:  item.commit.author?.name  || user,
    authorEmail: item.commit.author?.email || '',
    avatarUrl:   item.author?.avatar_url   || '',
    date:        item.commit.committer?.date || '',
  };
}

/**
 * Retry a search page while its result cannot be trusted, and report whether it
 * ever became trustworthy. The caller decides what an untrustworthy result
 * means, because that differs sharply by endpoint:
 *
 *  - Commit search: an empty timed-out page really can hide commits (the
 *    2026-09-08 incident had total_count=0 while GitHub held 43), so the caller
 *    narrows the window and ultimately raises.
 *  - Issue/PR search: an EMPTY result set routinely reports
 *    incomplete_results=true while being perfectly correct — verified against
 *    GitHub for bots and non-engineers with genuinely zero merged PRs. Raising
 *    on that produced 19 false skips in one run and aborted the report, so the
 *    caller only raises on a self-contradicting page.
 */
async function searchPageWithRetry<T extends SearchAccounting>(
  label: string,
  user:  string,
  page:  number,
  call:  () => Promise<{ data: T }>,
  log?:  (msg: string) => void,
): Promise<{ data: T; trustworthy: boolean }> {
  // Seeded on the first pass rather than cast from null at the end: the loop
  // bound makes the null impossible today, and would make it an undefined the
  // moment SEARCH_TIMEOUT_RETRIES changed.
  let last: T | undefined;
  for (let attempt = 0; attempt <= SEARCH_TIMEOUT_RETRIES; attempt++) {
    const res = await call();
    logSearchAccounting(label, user, page, res.data, log);
    last = res.data;
    if (!isSuspectSearchResult(res.data)) return { data: res.data, trustworthy: true };
    if (attempt < SEARCH_TIMEOUT_RETRIES) {
      log?.(
        `[search] ${label} @${user} page=${page} untrustworthy ` +
        `(attempt ${attempt + 1}/${SEARCH_TIMEOUT_RETRIES + 1}); retrying`,
      );
      await sleep(SEARCH_TIMEOUT_RETRY_MS);
    }
  }
  /* istanbul ignore next -- unreachable while SEARCH_TIMEOUT_RETRIES >= 0 */
  if (last === undefined) throw new Error(`[search] ${label} @${user}: no response captured`);
  return { data: last, trustworthy: false };
}

/**
 * Collect a user's commits for one date window.
 *
 * GitHub documents no remedy for `incomplete_results` beyond "narrow your
 * query", so the policy here is ours: retry the same page a couple of times,
 * then narrow by halving the window, and only then raise. Raising matters —
 * it turns the failure into a SKIP the GLOOK-13/48 integrity guard counts,
 * instead of a silent zero that drops the developer from the report with no
 * signal anywhere (GLOOK-50).
 */
async function collectCommits(
  org:   string,
  user:  string,
  from:  Date,
  to:    Date | null,
  log:   ((msg: string) => void) | undefined,
  depth: number,
): Promise<{ hits: RawCommitHit[]; shortfall?: SearchShortfall }> {
  const clause = commitDateClause(from, to);
  const query  = `org:${org} author:${user} ${clause}`;
  const hits: RawCommitHit[] = [];

  let page = 1;
  // The reconciliation baseline comes from page 1 and is only ever revised
  // upward. Re-reading it each page let a later `{total_count: 0, items: []}`
  // page — a shape the trust predicate correctly blesses — reset the promise
  // page 1 made and wave 100-of-250 through silently.
  let expectedTotal: number | null = null;

  while (true) {
    await sleep(2500);

    const { data, trustworthy } = await searchPageWithRetry(
      'commits', user, page,
      () => withRetry(
        () => getOctokit().search.commits({
          q: query, sort: 'committer-date', order: 'desc', per_page: SEARCH_PER_PAGE, page,
        }),
        log,
      ),
      log,
    );

    if (!trustworthy) {
      const halves = splitDateWindow(from, to);
      if (halves && depth < MAX_WINDOW_SPLIT_DEPTH) {
        log?.(`[search] commits @${user} ${clause}: narrowing window after repeated timeouts`);
        const [a, b] = halves;
        const left  = await collectCommits(org, user, a.from, a.to, log, depth + 1);
        const right = await collectCommits(org, user, b.from, b.to, log, depth + 1);
        const seen = new Set(left.hits.map((h) => h.sha));
        const merged = [...left.hits, ...right.hits.filter((h) => !seen.has(h.sha))];
        const shortfalls = [left.shortfall, right.shortfall].filter(Boolean) as SearchShortfall[];
        return {
          hits: merged,
          shortfall: shortfalls.length === 0 ? undefined : {
            expected:  shortfalls.reduce((n, sf) => n + sf.expected, 0),
            collected: shortfalls.reduce((n, sf) => n + sf.collected, 0),
            detail:    shortfalls.map((sf) => sf.detail).join('; '),
          },
        };
      }
      throw new Error(
        `GitHub commit search gave no trustworthy result for @${user} (${clause}) ` +
        `after ${SEARCH_TIMEOUT_RETRIES + 1} attempts` +
        (halves ? '' : ' and the window is too small to narrow further'),
      );
    }

    // `items` is optional on the type, and the trust predicate deliberately
    // tolerates its absence — so it must not be iterated raw here, or a shape
    // the tests bless becomes a TypeError and a hard SKIP.
    const items = (data.items ?? []) as any[];
    const pageTotal = data.total_count ?? 0;
    expectedTotal = expectedTotal === null ? pageTotal : Math.max(expectedTotal, pageTotal);

    for (const item of items) hits.push(toRawHit(item as any, user));

    // Stop at GitHub's 1000-result ceiling. Paging past it returns
    // "Only the first 1000 search results are available", which previously
    // surfaced as an unexplained SKIP for high-volume authors.
    if (hits.length >= Math.min(expectedTotal, SEARCH_RESULT_CAP)) break;
    if (items.length < SEARCH_PER_PAGE) break;
    page++;
  }

  const counted = expectedTotal ?? 0;
  // Clamped to the cap, NOT gated on it. `counted <= CAP && hits < counted`
  // disabled the check entirely above 1000, leaving the silent-loss hole open
  // for exactly the high-volume authors the cap was added for.
  const expected = Math.min(counted, SEARCH_RESULT_CAP);

  if (counted > SEARCH_RESULT_CAP) {
    log?.(
      `[search] commits @${user} ${clause}: total_count=${counted} exceeds the ` +
      `${SEARCH_RESULT_CAP}-result cap — this developer's commits are truncated`,
    );
  }

  if (hits.length < expected) {
    const detail =
      `${clause}: got ${hits.length} of ${expected}` +
      (counted > SEARCH_RESULT_CAP ? ` (capped from ${counted})` : '');

    // Nothing usable — raise, so it becomes a counted SKIP.
    if (hits.length === 0) {
      throw new Error(`GitHub commit search under-delivered for @${user} (${detail})`);
    }

    // Partial but real. Keep it and report the shortfall instead of discarding
    // known-good commits, which would be a regression against main.
    log?.(`[search] commits @${user} SHORTFALL ${detail}`);
    return {
      hits,
      shortfall: { expected, collected: hits.length, detail },
    };
  }

  return { hits };
}

/**
 * Search all commits by a user in an org within a date range.
 * Uses the commit search API — gives the complete picture including
 * direct pushes that never went through a PR.
 *
 * Returns the hits plus an optional shortfall: real-but-incomplete data is
 * kept and reported, only a total absence of trustworthy data raises.
 */
export async function searchUserCommits(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<{ hits: RawCommitHit[]; shortfall?: SearchShortfall }> {
  return collectCommits(org, user, since, null, log, 0);
}

// ---------- Per-user PR search ----------

async function searchUserMergedPRs(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<{ prs: PRInfo[]; unverified?: string }> {
  const sinceStr = since.toISOString().split('T')[0];
  const query    = `org:${org} type:pr is:merged author:${user} merged:>=${sinceStr}`;
  const prs: PRInfo[] = [];

  let page = 1;
  let expectedTotal: number | null = null;
  while (true) {
    await sleep(2500);
    const { data, trustworthy } = await searchPageWithRetry(
      'merged-prs', user, page,
      () => withRetry(
        () => getOctokit().search.issuesAndPullRequests({
          q: query, sort: 'updated', order: 'desc', per_page: 100, page,
        }),
        log,
      ),
      log,
    );

    // Monotonic, like collectCommits: page 1's promise must survive a later
    // page reporting a lower (or zero) total, or a page-2 timeout silently
    // rewrites how many PRs we were owed.
    expectedTotal = expectedTotal === null
      ? (data.total_count ?? 0)
      : Math.max(expectedTotal, data.total_count ?? 0);

    if (!trustworthy) {
      // A self-contradicting page is wrong no matter how it is read.
      if (isContradictoryPage(data)) {
        throw new Error(
          `GitHub merged-PR search gave no trustworthy result for @${user}: ` +
          `counted ${data.total_count} PRs but delivered none (page ${page})`,
        );
      }
      // Mid-pagination timeout. The leniency below is a PAGE-1 observation —
      // by now page 1 has already told us how many PRs exist, so returning
      // what we have would be the GLOOK-50 undercount moved to page N.
      if (prs.length > 0 || expectedTotal > 0) {
        throw new Error(
          `GitHub merged-PR search gave no trustworthy result for @${user}: ` +
          `under-delivered ${prs.length} of ${expectedTotal} (page ${page})`,
        );
      }
      // Nothing collected and nothing promised: an EMPTY issue search routinely
      // sets incomplete_results while being correct — verified against GitHub
      // for bots and non-engineers with genuinely zero merged PRs. Treating it
      // as a failure produced 19 false skips in one run and aborted the report
      // at 21%. Keep the zero, record the doubt.
      const unverified =
        `merged-PR search timed out on an empty result (page ${page}); kept 0 as unverified`;
      log?.(`[search] merged-prs @${user} UNVERIFIED ${unverified}`);
      return { prs, unverified };
    }

    if (page === 1 && data.total_count === 0) return { prs: [] };

    for (const item of (data.items ?? []) as any[]) {
      const repoFullName = item.repository_url.split('/repos/')[1] || '';
      const repo = repoFullName.split('/')[1] || '';
      prs.push({
        number:   item.number,
        title:    item.title,
        repo,
        mergedAt: item.pull_request?.merged_at || '',
      });
    }
    // Same 1000-result ceiling as the commit search: paging past it returns
    // "Only the first 1000 search results are available".
    if (prs.length >= Math.min(expectedTotal ?? 0, SEARCH_RESULT_CAP)) break;
    if ((data.items ?? []).length < SEARCH_PER_PAGE) break;
    page++;
  }

  // Reconcile, as the commit path does: a short page must not quietly end the
  // walk below what page 1 promised.
  const owed = Math.min(expectedTotal ?? 0, SEARCH_RESULT_CAP);
  if (prs.length < owed) {
    throw new Error(
      `GitHub merged-PR search under-delivered for @${user}: got ${prs.length} of ${owed}`,
    );
  }
  return { prs };
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
  const commitResult = await searchUserCommits(org, user, since, log);
  const rawCommits = commitResult.hits;
  const prResult   = await searchUserMergedPRs(org, user, since, log);
  const prs        = prResult.prs;

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

  return {
    commits,
    prs,
    commitsShortfall: commitResult.shortfall,
    prsUnverified:    prResult.unverified,
  };
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

async function countReviewedPRs(
  org: string,
  user: string,
  since: Date,
  log?: (msg: string) => void,
): Promise<{ reviews: number; unverified?: string }> {
  const sinceStr = since.toISOString().split('T')[0];
  const q = `org:${org} is:pr is:merged reviewed-by:${user} merged:>${sinceStr}`;
  await sleep(2500);
  const { data, trustworthy } = await searchPageWithRetry(
    'reviewed-prs', user, 1,
    () => withRetry(
      () => getOctokit().search.issuesAndPullRequests({ q, per_page: 1 }),
      log,
    ),
    log,
  );
  // per_page:1 means items is capped at 1 while total_count is the real answer,
  // so the "counts matches but delivered nothing" arm cannot fire here. The
  // timeout arm still can, and a timed-out review count reads 0 — which halves
  // a scoring factor (weight 0.5, min(reviews/15, 1)) and moves the developer
  // down the ranking.
  if (!trustworthy) {
    // per_page:1 caps items at 1, so isContradictoryPage can effectively never
    // fire here — which means without a doubt channel this endpoint would trust
    // everything. A timed-out review count reads 0 and halves a scoring factor
    // (weight 0.5, min(reviews/15, 1)), moving the developer down the ranking.
    // Keep the number, hand the caller the doubt.
    const unverified =
      `review-count search timed out (total_count=${data.total_count ?? 0}); kept as unverified`;
    log?.(`[search] reviewed-prs @${user} UNVERIFIED ${unverified}`);
    return { reviews: data.total_count ?? 0, unverified };
  }
  return { reviews: data.total_count ?? 0 };
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
    logSearchAccounting('open-prs', user, page, res.data, log);
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

// ---------- Vulnerability tracking (GLOOK-43) ----------

/** GitHub's exact message for archived repos. */
export const ARCHIVED_ALERTS_MESSAGE = 'Dependabot alerts are not available for archived repositories.';

/** GitHub's exact message when a repo has Dependabot alerts turned off. Pinned the same way as
 * ARCHIVED_ALERTS_MESSAGE: exact match, not a substring — a repo with Dependabot off is
 * unmeasured but this is not a sync issue. */
export const DEPENDABOT_OFF_MESSAGE = 'Dependabot alerts are disabled for this repository.';

/**
 * GLOOK-43: a hung GitHub request (no response, no error — the connection just never
 * completes) has no rate-limit header and no HTTP status, so withRetry's classification never
 * fires and the request waits forever, keeping the in-process sync flag set (scheduler.ts) until
 * the process restarts. Every vulnerability-module `kit.request` call passes this as its abort
 * signal so a hung request eventually fails visibly instead of wedging the sync. Scoped to this
 * module only — the shared Octokit instance and every report-path call are untouched.
 *
 * GLOOK-43: `AbortSignal.timeout` rejects the underlying `fetch` with a
 * `TimeoutError`, not `AbortError` — `AbortError` is the name reserved for a signal aborted by an
 * explicit `controller.abort()` call. `@octokit/request`'s fetch wrapper (dist-src/fetch-wrapper.js)
 * only special-cases the literal name `AbortError` (rethrowing that error as-is with
 * `error.status = 500` added); a `TimeoutError` falls through to the wrapper's generic branch,
 * which instead wraps it in a `RequestError` with `status: 500`. Either way withRetry classifies
 * the failure as a transient 5xx and retries it (up to 3 attempts) rather than as a rate limit or
 * a network error — that's fine per the design: a final timeout still fails the run visibly, just
 * after a shallow retry budget like any other transient failure.
 */
export const VULN_GITHUB_TIMEOUT_MS = 60_000;

function nextLink(headers: Record<string, any> | undefined): string | null {
  const link = headers?.link as string | undefined;
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/**
 * Manual Link-header pager: every page is its own withRetry call, so a rate limit retries
 * one page, not the whole sweep. Do NOT replace with one withRetry around paginate.iterator.
 *
 * Maps each page as it arrives (GLOOK-43) instead of collecting every raw page
 * and mapping afterwards — a raw org-scale Dependabot alert page is sizeable per 100 alerts, so
 * collecting them all for a full sweep would hold every raw page in memory that was thrown
 * away a moment later by the callers' own .map().
 */
async function fetchAllPages<T, R>(
  route: string, params: Record<string, unknown>, map: (raw: T) => R, log?: (m: string) => void,
): Promise<R[]> {
  const kit: any = getOctokit();
  const out: R[] = [];
  let page = 1;
  // The signal is created inside each withRetry attempt (not once, outside), so a retry after a
  // timeout gets a fresh VULN_GITHUB_TIMEOUT_MS window instead of an already-aborted one.
  let res: any = await withRetry(() => kit.request(route, { ...params, request: { signal: AbortSignal.timeout(VULN_GITHUB_TIMEOUT_MS) } }), log);
  out.push(...(res.data as T[]).map(map));
  let next = nextLink(res.headers);
  while (next) {
    const url = next;
    res = await withRetry(() => kit.request(`GET ${url}`, { request: { signal: AbortSignal.timeout(VULN_GITHUB_TIMEOUT_MS) } }), log);
    out.push(...(res.data as T[]).map(map));
    page++;
    // GLOOK-43: a full sweep can run for minutes with no output, so the syncs
    // tab showed a fixed "running · fetching alerts" label the whole time. Log every 20 pages
    // (never the full URL with query parameters, just the route
    // template) so an operator watching the server console can tell the sync is actually
    // making progress.
    if (page % 20 === 0) log?.(`${route}: page ${page}, ${out.length} items`);
    next = nextLink(res.headers);
  }
  return out;
}

const isoOrNull = (v: unknown): string | null => (v ? toIsoSecond(String(v)) : null);

/**
 * Truncates a string to its column's limit, so a legitimately long GitHub value (a deep monorepo
 * manifest path, a verbose dismissed_reason) can't blow up a MySQL strict-mode INSERT (GLOOK-43).
 * `summary` is TEXT and is never passed through this. `onClip` lets the caller count
 * how many fields were clipped across a whole page/sweep without module-level mutable state.
 */
function clip<T extends string | null>(s: T, n: number, onClip: () => void): T {
  if (s !== null && s.length > n) { onClip(); return s.slice(0, n) as T; }
  return s;
}

/**
 * Replaces every code point above U+FFFF (a surrogate pair in UTF-16 — an emoji, most
 * supplementary-plane CJK, etc.) with U+FFFD (GLOOK-43).
 *
 * Dev's MySQL database is utf8mb3 (charsets are never pinned — see the root CLAUDE.md), which
 * rejects a 4-byte UTF-8 character in any TEXT/VARCHAR column with `ERROR 1366 Incorrect string
 * value`, rolling back the whole write transaction and so the entire daily sync. Applied BEFORE
 * `clip()` everywhere both run, so `clip`'s `slice()` can never land mid-surrogate-pair either —
 * once bmpOnly has run, there are no pairs left to split.
 */
export function bmpOnly<T extends string | null>(s: T, onSanitize: () => void = () => {}): T {
  if (s === null) return s;
  const out = (s as string).replace(/[\u{10000}-\u{10FFFF}]/gu, '�');
  if (out !== s) onSanitize();
  return out as T;
}

function mapAlert(a: any, onClip: () => void = () => {}, onSanitize: () => void = () => {}): FetchedAlert {
  const adv = a.security_advisory ?? {};
  const b = <T extends string | null>(v: T): T => bmpOnly(v, onSanitize);
  return {
    repoId: Number(a.repository.id), repoFullName: b(a.repository.full_name), number: Number(a.number),
    htmlUrl: clip(b(a.html_url), 500, onClip), state: a.state, severity: adv.severity,
    ghsaId: clip(b(adv.ghsa_id ?? null), 64, onClip), cveId: clip(b(adv.cve_id ?? null), 64, onClip), summary: b(adv.summary ?? null),
    cvssScore: adv.cvss?.score ?? null, epssPercentage: adv.epss?.percentage ?? null,
    advisoryWithdrawnAt: isoOrNull(adv.withdrawn_at),
    packageName: clip(b(a.dependency?.package?.name ?? null), 255, onClip),
    ecosystem: clip(b(a.dependency?.package?.ecosystem ?? null), 64, onClip),
    manifestPath: clip(b(a.dependency?.manifest_path ?? null), 500, onClip),
    relationship: clip(b(a.dependency?.relationship ?? null), 32, onClip),
    scope: clip(b(a.dependency?.scope ?? null), 32, onClip),
    firstPatchedVersion: clip(b(a.security_vulnerability?.first_patched_version?.identifier ?? null), 128, onClip),
    createdAt: toIsoSecond(a.created_at), updatedAt: isoOrNull(a.updated_at),
    fixedAt: isoOrNull(a.fixed_at), dismissedAt: isoOrNull(a.dismissed_at),
    autoDismissedAt: isoOrNull(a.auto_dismissed_at), dismissedReason: clip(b(a.dismissed_reason ?? null), 64, onClip),
  };
}

export async function listOrgDependabotAlerts(org: string, log?: (m: string) => void, onDataNotice?: OnDataNotice): Promise<FetchedAlert[]> {
  let clippedFields = 0, sanitizedFields = 0;
  const alerts = await fetchAllPages<any, FetchedAlert>('GET /orgs/{org}/dependabot/alerts', {
    org, severity: 'critical,high', state: 'open,fixed,dismissed,auto_dismissed', per_page: 100,
  }, (raw) => mapAlert(raw, () => { clippedFields++; }, () => { sanitizedFields++; }), log);
  if (sanitizedFields > 0) { log?.(`listOrgDependabotAlerts: replaced 4-byte characters in ${sanitizedFields} field(s)`); onDataNotice?.('sanitized', sanitizedFields); }
  if (clippedFields > 0) { log?.(`listOrgDependabotAlerts: clipped ${clippedFields} field(s) exceeding their column limits`); onDataNotice?.('clipped', clippedFields); }
  // Belt-and-suspenders: the request already asks GitHub to filter to critical/high, but keep out
  // anything that slips through with a different severity rather than trust that server-side filter
  // silently (severities are critical/high only — see global-constraints).
  const kept = alerts.filter(a => a.severity === 'critical' || a.severity === 'high');
  const skipped = alerts.length - kept.length;
  if (skipped > 0) log?.(`listOrgDependabotAlerts: skipped ${skipped} alert(s) with a severity outside critical/high`);
  return kept;
}

export async function listOrgReposForVulns(org: string, log?: (m: string) => void, onDataNotice?: OnDataNotice): Promise<FetchedRepo[]> {
  let sanitizedFields = 0;
  const onSanitize = () => { sanitizedFields++; };
  const repos = await fetchAllPages<any, FetchedRepo>('GET /orgs/{org}/repos', { org, type: 'all', per_page: 100 },
    r => ({ repoId: Number(r.id), fullName: bmpOnly(r.full_name, onSanitize), archived: Boolean(r.archived) }), log);
  if (sanitizedFields > 0) { log?.(`listOrgReposForVulns: replaced 4-byte characters in ${sanitizedFields} field(s)`); onDataNotice?.('sanitized', sanitizedFields); }
  return repos;
}

export async function listOrgRepoProperties(
  org: string, keys: PropertyKeys, log?: (m: string) => void, onDataNotice?: OnDataNotice,
): Promise<FetchedPropertiesResult> {
  let sanitizedFields = 0;
  const onSanitize = () => { sanitizedFields++; };
  const raw = await fetchAllPages<any, RawPropertyRow>('GET /orgs/{org}/properties/values', { org, per_page: 100 }, r => ({
    repoId: Number(r.repository_id),
    fullName: bmpOnly(r.repository_full_name, onSanitize),
    properties: (r.properties ?? []).map((x: any) => ({
      property_name: x.property_name,
      value: typeof x.value === 'string' ? bmpOnly(x.value, onSanitize) : x.value,
    })),
  }), log);
  if (sanitizedFields > 0) { log?.(`listOrgRepoProperties: replaced 4-byte characters in ${sanitizedFields} field(s)`); onDataNotice?.('sanitized', sanitizedFields); }
  return mapPropertyRows(raw, keys);
}

function errMessage(err: any): string {
  return err?.response?.data?.message ?? (err instanceof Error ? err.message : String(err));
}

export async function getRepoDependabotStatus(fullName: string, log?: (m: string) => void): Promise<RepoAlertStatus> {
  const [owner, repo] = fullName.split('/');
  try {
    await withRetry(() => (getOctokit() as any).request('GET /repos/{owner}/{repo}/dependabot/alerts', {
      owner, repo, per_page: 1, request: { signal: AbortSignal.timeout(VULN_GITHUB_TIMEOUT_MS) },
    }), log);
    return { status: 'ok' };
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    const message = errMessage(err);
    if (status === 403 && message === ARCHIVED_ALERTS_MESSAGE) return { status: 'archived' };
    if (status === 403 && message === DEPENDABOT_OFF_MESSAGE) return { status: 'dependabot-off', detail: message };
    return { status: 'error', detail: `HTTP ${status ?? '?'}: ${message}` };
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
    listOrgReposForVulns,
    listOrgRepoProperties,
    listOrgDependabotAlerts,
    getRepoDependabotStatus,
  };
  return cachedProvider;
}
