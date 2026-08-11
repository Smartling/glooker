import { extractSkillsEntries } from './skills-parser';
import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult, PerEmailSkills, PerEmailModelCost, ModelUsage } from './provider';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANALYTICS_PATH = '/v1/organizations/analytics/user_cost_report';
const USERS_PATH = '/v1/organizations/analytics/users';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 60_000;
const MAX_PAGES = 100;
/**
 * The grouped model-cost pull appends group_by[]=model, which fans one
 * per-user row out into one row per (user, model) — roughly an order of
 * magnitude more rows than the ungrouped pull for the same population and
 * window. Sharing MAX_PAGES would trip at ~10x fewer users than the ungrouped
 * pull tolerates, so it gets its own, larger cap.
 */
const MODEL_MAX_PAGES = 1000;

export class AnthropicAnalyticsKeyMissingError extends Error {
  constructor() {
    super('ANTHROPIC_ANALYTICS_API_KEY is not set');
    this.name = 'AnthropicAnalyticsKeyMissingError';
  }
}

interface AnalyticsActor {
  type?: string;
  user_id?: string;
  name?: string;
  email?: string;
  deleted?: boolean;
}

interface AnalyticsRow {
  actor?: AnalyticsActor;
  amount?: string;
  requests?: number;
}

interface AnalyticsResponse {
  data?: AnalyticsRow[];
  has_more?: boolean;
  next_page?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function buildUrl(periodStart: string, periodEnd: string, cursor: string | null, limit: number): string {
  const url = new URL(`${ANTHROPIC_BASE}${ANALYTICS_PATH}`);
  url.searchParams.set('starting_at', `${periodStart}T00:00:00Z`);
  url.searchParams.set('ending_at', `${periodEnd}T23:59:59Z`);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('page', cursor);
  return url.toString();
}

/**
 * The /users endpoint takes DATES (starting_date/ending_date), not the
 * starting_at/ending_at timestamps the cost endpoint uses. Its cursor param is
 * `page`; passing the token as `next_page`/`cursor` is silently ignored and
 * re-serves page 1, which would spin until MAX_PAGES.
 */
function buildUsersUrl(periodStart: string, periodEnd: string, cursor: string | null, limit: number): string {
  const url = new URL(`${ANTHROPIC_BASE}${USERS_PATH}`);
  url.searchParams.set('starting_date', periodStart);
  url.searchParams.set('ending_date', periodEnd);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('page', cursor);
  return url.toString();
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Parse Retry-After (integer seconds OR HTTP date). Cap at MAX_RETRY_WAIT_MS. Fallback: 2500ms * attempt. */
function getRetryWaitMs(headers: Headers | { get: (k: string) => string | null }, attempt: number): number {
  const raw = headers.get('retry-after');
  if (raw) {
    const trimmed = raw.trim();
    // Integer seconds?
    if (/^\d+$/.test(trimmed)) {
      const secs = parseInt(trimmed, 10);
      return Math.min(secs * 1000, MAX_RETRY_WAIT_MS);
    }
    // HTTP date?
    const ts = Date.parse(trimmed);
    if (Number.isFinite(ts)) {
      const delta = ts - Date.now();
      return Math.max(0, Math.min(delta, MAX_RETRY_WAIT_MS));
    }
  }
  return 2500 * attempt;
}

async function fetchPage(
  apiKey: string,
  urlStr: string,
  log?: (msg: string) => void,
): Promise<AnalyticsResponse> {
  const init: RequestInit = {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  };

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetchWithTimeout(urlStr, init);
      if (res.ok) return await res.json() as AnalyticsResponse;
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Anthropic Analytics API ${res.status}: auth failed`);
      }
      if (isRetryableStatus(res.status) && attempt <= MAX_RETRIES) {
        const waitMs = getRetryWaitMs(res.headers, attempt);
        log?.(`anthropic analytics ${res.status}, retry ${attempt}/${MAX_RETRIES} after ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Anthropic Analytics API ${res.status}`);
    } catch (err) {
      // Don't retry auth errors we threw above; rethrow them immediately.
      if (err instanceof Error && /\b(401|403)\b/.test(err.message)) throw err;
      // Don't retry well-formed status throws we just made (e.g. 400, 404 with status in msg).
      if (err instanceof Error && /Anthropic Analytics API \d{3}/.test(err.message)) throw err;
      if (attempt <= MAX_RETRIES) {
        const waitMs = 2500 * attempt;
        const msg = err instanceof Error ? err.message : String(err);
        log?.(`anthropic analytics fetch failed (${msg}), retry ${attempt}/${MAX_RETRIES} after ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

function accumulate(
  agg: Map<string, PerEmailAggregate>,
  rows: AnalyticsRow[],
): void {
  for (const row of rows) {
    if (row.actor?.type !== 'user_actor') continue;
    if (row.actor?.deleted === true) continue;
    const rawEmail = row.actor?.email;
    if (!rawEmail) continue;
    const email = rawEmail.trim().toLowerCase();

    const amountStr = row.amount;
    const amountNum = typeof amountStr === 'string' ? parseFloat(amountStr) : NaN;
    const costCents = Number.isFinite(amountNum) ? Math.round(amountNum) : 0;
    const requests = Number(row.requests) || 0;

    let entry = agg.get(email);
    if (!entry) {
      entry = { email, costCents: 0, requests: 0 };
      agg.set(email, entry);
    }
    entry.costCents += costCents;
    entry.requests += requests;
  }
}

export function createAnthropicCcSpendProvider(): CcSpendProvider {
  async function pullByPeriod(
    periodStart: string,
    periodEnd: string,
    log?: (msg: string) => void,
  ): Promise<PerEmailAggregate[]> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    const agg = new Map<string, PerEmailAggregate>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = buildUrl(periodStart, periodEnd, cursor, 1000);
      const page = await fetchPage(apiKey, url, log);
      accumulate(agg, page.data ?? []);
      cursor = page.next_page ?? null;
      // Only count the cap against a page we're actually about to fetch next —
      // checking unconditionally would trip on a legitimate final page whose
      // count happens to land on MAX_PAGES even though cursor is already null.
      pages++;
      if (cursor && pages >= MAX_PAGES) {
        throw new Error(`Anthropic analytics pagination exceeded ${MAX_PAGES} pages — refusing to continue`);
      }
    } while (cursor);

    return [...agg.values()];
  }

  async function probe(date: string): Promise<CcSpendProbeResult> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    const url = buildUrl(date, date, null, 10);
    const page = await fetchPage(apiKey, url);

    // Filter to user_actor + non-deleted, then dedupe by lowercased email — this is what
    // pullByPeriod would aggregate, so the connection-test count matches reality.
    const users = new Set<string>();
    for (const row of page.data ?? []) {
      if (row.actor?.type !== 'user_actor') continue;
      if (row.actor?.deleted === true) continue;
      const email = row.actor?.email?.trim().toLowerCase();
      if (email) users.add(email);
    }

    return {
      userCount: users.size,
      sampleEmail: [...users][0],
    };
  }

  async function pullSkillsByPeriod(
    periodStart: string,
    periodEnd: string,
    log?: (msg: string) => void,
  ): Promise<PerEmailSkills[]> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    // A date range returns one aggregated row per user (keyset-paginated by
    // email), so this Map is defensive rather than load-bearing.
    const byEmail = new Map<string, PerEmailSkills>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = buildUsersUrl(periodStart, periodEnd, cursor, 1000);
      const page = await fetchPage(apiKey, url, log) as { data?: any[]; next_page?: string | null };
      for (const row of page.data ?? []) {
        const rawEmail = row?.user?.email_address;
        if (!rawEmail) continue;
        const email = String(rawEmail).trim().toLowerCase();
        const products = extractSkillsEntries(row);
        if (products.length === 0) continue;
        const existing = byEmail.get(email);
        if (existing) existing.products.push(...products);
        else byEmail.set(email, { email, products });
      }
      cursor = page.next_page ?? null;
      // See pullByPeriod's identical guard for why this only counts against a
      // page we're about to fetch, not the one we just finished.
      pages++;
      if (cursor && pages >= MAX_PAGES) {
        throw new Error(`Anthropic analytics pagination exceeded ${MAX_PAGES} pages — refusing to continue`);
      }
    } while (cursor);

    return [...byEmail.values()];
  }

  async function pullModelCostByPeriod(
    periodStart: string,
    periodEnd: string,
    log?: (msg: string) => void,
  ): Promise<PerEmailModelCost[]> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    const byEmail = new Map<string, Map<string, ModelUsage>>();
    let cursor: string | null = null;
    let pages = 0;
    // Dollars dropped because the API didn't attribute a row to an email
    // and/or a model — the ungrouped pullByPeriod counts these same dollars
    // into cc_total_cost, so a nonzero total here means this grouped
    // breakdown undercounts it. Logged once per pull rather than per row.
    let droppedCents = 0;
    do {
      // The `[]` is required: group_by=model (no brackets) is silently ignored
      // and every row comes back with model: null.
      const url = `${buildUrl(periodStart, periodEnd, cursor, 1000)}&group_by%5B%5D=model`;
      const page = await fetchPage(apiKey, url, log) as { data?: any[]; next_page?: string | null };
      for (const row of page.data ?? []) {
        if (row?.actor?.type !== 'user_actor') continue;
        if (row?.actor?.deleted === true) continue;
        const rawEmail = row?.actor?.email;
        const model = row?.model;
        // Number(...) (not a string-only parseFloat) so a JSON-number amount
        // isn't silently read as NaN -> 0 — Anthropic sends `amount` as a
        // decimal string today, but nothing documents that as guaranteed.
        const amountNum = Number(row?.amount);
        if (!rawEmail || !model) {
          if (Number.isFinite(amountNum)) droppedCents += Math.round(amountNum);
          continue;
        }
        const email = String(rawEmail).trim().toLowerCase();

        const costCents = Number.isFinite(amountNum) ? Math.round(amountNum) : 0;
        const requests = Number(row.requests) || 0;

        let models = byEmail.get(email);
        if (!models) { models = new Map<string, ModelUsage>(); byEmail.set(email, models); }
        const entry = models.get(String(model)) ?? { model: String(model), costCents: 0, requests: 0 };
        entry.costCents += costCents;
        entry.requests += requests;
        models.set(entry.model, entry);
      }
      cursor = page.next_page ?? null;
      // This pull fans one per-user row out into one row per (user, model), so
      // it needs its own, larger cap than the ungrouped pulls (MODEL_MAX_PAGES,
      // not MAX_PAGES) — see its doc comment. Off-by-one guard as above.
      pages++;
      if (cursor && pages >= MODEL_MAX_PAGES) {
        throw new Error(`Anthropic analytics pagination exceeded ${MODEL_MAX_PAGES} pages — refusing to continue`);
      }
    } while (cursor);

    if (droppedCents > 0) {
      log?.(`CC models: dropped ${droppedCents}c with no email/model attribution`);
    }

    return [...byEmail.entries()].map(([email, models]) => ({ email, models: [...models.values()] }));
  }

  return { pullByPeriod, probe, pullSkillsByPeriod, pullModelCostByPeriod };
}
