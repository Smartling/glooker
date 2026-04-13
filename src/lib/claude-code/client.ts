const API_BASE = 'https://api.anthropic.com';

export interface ClaudeCodeDailyRecord {
  email: string;
  totalCost: number;       // cents USD, summed across all models
  inputTokens: number;     // uncached + cache_read + cache_creation
  outputTokens: number;
  sessions: number;
}

export interface ClaudeCodeClientInterface {
  fetchDailySpend(date: string): Promise<ClaudeCodeDailyRecord[]>;
}

export class ClaudeCodeClient implements ClaudeCodeClientInterface {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchDailySpend(date: string): Promise<ClaudeCodeDailyRecord[]> {
    const records: ClaudeCodeDailyRecord[] = [];
    let page: string | null = null;

    do {
      let url = `${API_BASE}/v1/organizations/usage_report/claude_code?starting_at=${date}&limit=1000`;
      if (page) url += `&page=${page}`;

      const res = await fetch(url, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Claude Code API error ${res.status}: ${text}`);
      }

      const body = await res.json();

      for (const record of body.data || []) {
        if (record.actor?.type !== 'user_actor') continue;

        const email = record.actor.email_address;
        if (!email) continue;

        let totalCost = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        for (const m of record.model_breakdown || []) {
          totalCost += Number(m.estimated_cost?.amount || 0);
          const t = m.tokens || {};
          inputTokens += (t.input || 0) + (t.cache_read || 0) + (t.cache_creation || 0);
          outputTokens += t.output || 0;
        }

        records.push({
          email,
          totalCost: Math.round(totalCost * 100) / 100,
          inputTokens,
          outputTokens,
          sessions: record.num_sessions || 0,
        });
      }

      page = body.has_more ? body.next_page : null;
    } while (page);

    return records;
  }
}
