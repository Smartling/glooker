import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult } from './provider';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANALYTICS_PATH = '/v1/organizations/analytics/user_cost_report';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 60_000;
const MAX_PAGES = 100;

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
      if (++pages >= MAX_PAGES) {
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

  return { pullByPeriod, probe };
}
