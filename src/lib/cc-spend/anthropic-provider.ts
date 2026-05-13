import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult } from './provider';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicAdminKeyMissingError extends Error {
  constructor() {
    super('ANTHROPIC_ADMIN_API_KEY is not set');
    this.name = 'AnthropicAdminKeyMissingError';
  }
}

interface ClaudeCodeUserRow {
  actor?: { email_address?: string };
  num_sessions?: number;
  model_breakdown?: Array<{
    tokens?: { input?: number; output?: number };
    estimated_cost?: { amount?: string | number };
  }>;
}

interface DailyResponse {
  data?: ClaudeCodeUserRow[];
  next_page?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function eachDay(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function fetchPage(
  apiKey: string,
  date: string,
  cursor: string | null,
  log?: (msg: string) => void,
): Promise<DailyResponse> {
  const url = new URL(`${ANTHROPIC_BASE}/v1/organizations/usage_report/claude_code`);
  url.searchParams.set('starting_at', date);
  url.searchParams.set('limit', '1000');
  if (cursor) url.searchParams.set('page', cursor);

  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });
    if (res.ok) return await res.json() as DailyResponse;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Anthropic API ${res.status} for ${date}: auth failed`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 1) {
      log?.(`anthropic ${date} ${res.status}, retrying after 2.5s`);
      await sleep(2500);
      continue;
    }
    throw new Error(`Anthropic API ${res.status} for ${date}`);
  }
}

function accumulate(
  agg: Map<string, PerEmailAggregate>,
  rows: ClaudeCodeUserRow[],
): void {
  for (const row of rows) {
    const email = row.actor?.email_address?.trim().toLowerCase();
    if (!email) continue;
    let entry = agg.get(email);
    if (!entry) {
      entry = { email, costCents: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
      agg.set(email, entry);
    }
    entry.sessions += row.num_sessions ?? 0;
    for (const m of row.model_breakdown ?? []) {
      const costStr = m.estimated_cost?.amount;
      const cost = typeof costStr === 'string' ? Number(costStr) : (costStr ?? 0);
      entry.costCents += Number.isFinite(cost) ? cost : 0;
      entry.inputTokens += m.tokens?.input ?? 0;
      entry.outputTokens += m.tokens?.output ?? 0;
    }
  }
}

export function createAnthropicCcSpendProvider(): CcSpendProvider {
  async function pullByPeriod(
    periodStart: string,
    periodEnd: string,
    log?: (msg: string) => void,
  ): Promise<PerEmailAggregate[]> {
    const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
    if (!apiKey) throw new AnthropicAdminKeyMissingError();

    const agg = new Map<string, PerEmailAggregate>();
    for (const day of eachDay(periodStart, periodEnd)) {
      try {
        let cursor: string | null = null;
        do {
          const page = await fetchPage(apiKey, day, cursor, log);
          accumulate(agg, page.data ?? []);
          cursor = page.next_page ?? null;
        } while (cursor);
      } catch (err) {
        // Abort on auth failures; skip the day on transient failures.
        if (err instanceof Error && /(401|403)/.test(err.message)) throw err;
        log?.(`anthropic ${day} failed after retry; skipping day: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return [...agg.values()];
  }

  async function probe(date: string): Promise<CcSpendProbeResult> {
    const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
    if (!apiKey) throw new AnthropicAdminKeyMissingError();
    const page = await fetchPage(apiKey, date, null);
    const rows = page.data ?? [];
    return {
      userCount: rows.length,
      sampleEmail: rows[0]?.actor?.email_address,
    };
  }

  return { pullByPeriod, probe };
}
