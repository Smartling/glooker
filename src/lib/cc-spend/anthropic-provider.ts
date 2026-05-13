import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult } from './provider';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANALYTICS_PATH = '/v1/organizations/analytics/user_cost_report';

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

async function fetchPage(
  apiKey: string,
  urlStr: string,
  log?: (msg: string) => void,
): Promise<AnalyticsResponse> {
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(urlStr, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });
    if (res.ok) return await res.json() as AnalyticsResponse;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Anthropic Analytics API ${res.status}: auth failed`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 1) {
      log?.(`anthropic analytics ${res.status}, retrying after 2.5s`);
      await sleep(2500);
      continue;
    }
    throw new Error(`Anthropic Analytics API ${res.status}`);
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
    do {
      const url = buildUrl(periodStart, periodEnd, cursor, 1000);
      const page = await fetchPage(apiKey, url, log);
      accumulate(agg, page.data ?? []);
      cursor = page.next_page ?? null;
    } while (cursor);

    return [...agg.values()];
  }

  async function probe(date: string): Promise<CcSpendProbeResult> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    const url = buildUrl(date, date, null, 10);
    const page = await fetchPage(apiKey, url);

    // Filter to user_actor + non-deleted, matching the same shape we'd use in pullByPeriod.
    const users = (page.data ?? [])
      .filter(r => r.actor?.type === 'user_actor' && r.actor?.deleted !== true && r.actor?.email)
      .map(r => r.actor!.email!.trim().toLowerCase());

    return {
      userCount: users.length,
      sampleEmail: users[0],
    };
  }

  return { pullByPeriod, probe };
}
