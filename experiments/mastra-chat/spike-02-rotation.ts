/**
 * Phase 0b: the token MUST be re-read per request (expires ~24h).
 * spike-01 proved a static apiKey works and apiKey-as-function 401s.
 * Three candidate strategies, in order of preference.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { getAccessToken } from '../../src/lib/smartling-auth';

const baseUrl = process.env.SMARTLING_BASE_URL!;
const accountUid = process.env.SMARTLING_ACCOUNT_UID!;
const url = `${baseUrl}/ai-proxy-api/v2/accounts/${accountUid}/compatible/openai`;
const MODEL = 'smartling/anthropic/claude-sonnet-5';
const GEN = { modelSettings: { maxOutputTokens: 64 } } as any;

let reads = 0;
const freshToken = async () => { reads++; return getAccessToken(); };

async function tryIt(label: string, build: () => Agent | Promise<Agent>, perRequest: boolean) {
  reads = 0;
  try {
    const a1 = perRequest ? await build() : await build();
    const r1 = await a1.generate('Say: one.', GEN);
    const a2 = perRequest ? await build() : a1;
    const r2 = await a2.generate('Say: two.', GEN);
    console.log(`${label}: OK  replies=${JSON.stringify([r1.text, r2.text])}  tokenReads=${reads}`,
      reads >= 2 ? '  <= ROTATES' : '  <= does NOT rotate');
  } catch (e: any) {
    console.log(`${label}: FAILED  ${e?.message || e}`);
  }
}

async function main() {
  // C — headers as a function
  await tryIt('C headers-fn ', () => new Agent({
    id: 'c', name: 'c', instructions: 'One short sentence.',
    model: { id: MODEL, url, headers: async () => ({ Authorization: `Bearer ${await freshToken()}` }) } as any,
  }), false);

  // D — custom fetch injecting a fresh bearer per call
  await tryIt('D custom-fetch', () => new Agent({
    id: 'd', name: 'd', instructions: 'One short sentence.',
    model: {
      id: MODEL, url, apiKey: 'placeholder',
      fetch: async (input: any, init: any = {}) => {
        const h = new Headers(init.headers || {});
        h.set('Authorization', `Bearer ${await freshToken()}`);
        return globalThis.fetch(input, { ...init, headers: h });
      },
    } as any,
  }), false);

  // E — rebuild the agent per request (mirrors llm-provider.ts today)
  await tryIt('E per-request ', async () => new Agent({
    id: 'e', name: 'e', instructions: 'One short sentence.',
    model: { id: MODEL, url, apiKey: await freshToken() } as any,
  }), true);
}
main().catch(e => { console.error('fatal:', e?.message || e); process.exit(1); });
