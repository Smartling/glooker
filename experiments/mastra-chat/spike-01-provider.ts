/**
 * Phase 0 kill gate: can Mastra talk to the Smartling AI Proxy at all,
 * and can it pick up a ROTATED bearer token without rebuilding the agent?
 *
 * Glooker's llm-provider.ts deliberately rebuilds the OpenAI client on every
 * call ("Don't cache — token expires"). Mastra agents are long-lived objects,
 * so the token must be resolved per request or the app breaks silently ~24h
 * after boot. That is the whole question this spike answers.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { getAccessToken } from '../../src/lib/smartling-auth';

const baseUrl = process.env.SMARTLING_BASE_URL!;
const accountUid = process.env.SMARTLING_ACCOUNT_UID!;
const url = `${baseUrl}/ai-proxy-api/v2/accounts/${accountUid}/compatible/openai`;

let tokenReads = 0;

async function main() {
  console.log('proxy url:', url);

  const token = await getAccessToken();
  console.log('static token acquired:', token.slice(0, 8) + '…');

  // Test A — static apiKey. Proves connectivity and the model id format.
  const staticAgent = new Agent({
    id: 'spike-static',
    name: 'spike-static',
    instructions: 'Answer in exactly one short sentence.',
    model: { id: 'smartling/anthropic/claude-sonnet-5', url, apiKey: token } as any,
  });

  const a = await staticAgent.generate('Say the word: connected.', { modelSettings: { maxOutputTokens: 64 } });
  console.log('A static  ->', JSON.stringify(a.text));

  // Test B — apiKey as a function. If Mastra calls this per request, token
  // rotation works and the agent can be a long-lived singleton.
  const dynamicAgent = new Agent({
    id: 'spike-dynamic',
    name: 'spike-dynamic',
    instructions: 'Answer in exactly one short sentence.',
    model: {
      id: 'smartling/anthropic/claude-sonnet-5',
      url,
      apiKey: async () => { tokenReads++; return await getAccessToken(); },
    } as any,
  });

  const b1 = await dynamicAgent.generate('Say the word: one.', { modelSettings: { maxOutputTokens: 64 } });
  const b2 = await dynamicAgent.generate('Say the word: two.', { modelSettings: { maxOutputTokens: 64 } });
  console.log('B dynamic ->', JSON.stringify(b1.text), JSON.stringify(b2.text));
  console.log('B token fn invoked', tokenReads, 'time(s) across 2 requests');
  console.log(tokenReads >= 2 ? 'ROTATION: OK (resolved per request)' : 'ROTATION: NOT per-request');
}

main().catch(e => {
  const api = e?.cause ?? e;
  console.error('SPIKE FAILED:', e?.message || e);
  if (api?.requestBodyValues) {
    console.error('--- REQUEST BODY KEYS ---');
    console.error(JSON.stringify(Object.keys(api.requestBodyValues)));
    console.error(JSON.stringify(api.requestBodyValues, null, 2).slice(0, 900));
  }
  process.exit(1);
});
