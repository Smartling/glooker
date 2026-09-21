/**
 * Phase 2 differentiator B — persistent threads.
 *
 * The real test is not "does it remember within one process" (trivially true by
 * passing messages) but "does it remember across processes", which is what the
 * current chat cannot do: chat-panel.tsx holds messages in React state and
 * resends them; nothing is persisted server-side.
 *
 * Run twice. Pass 1 states a fact, pass 2 (fresh process) must recall it.
 * Mastra has no MySQL adapter, so this needs a LibSQL file alongside Glooker's MySQL.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createSmartlingAnthropic } from './smartling-anthropic';

const THREAD = 'phase2-memory-thread';
const RESOURCE = 'phase2-user';

async function main() {
  const pass = process.argv[2] === '2' ? 2 : 1;

  const memory = new Memory({
    storage: new LibSQLStore({ id: 'glooker-chat-memory', url: 'file:./experiments/mastra-chat/memory.db' }),
  });

  const agent = new Agent({
    id: 'mem-agent', name: 'mem-agent',
    instructions: 'You are a concise assistant. Use remembered context when relevant.',
    model: createSmartlingAnthropic({ operationName: 'glooker_chat_memory' })('claude-sonnet-5') as any,
    memory,
  });

  const prompt = pass === 1
    ? 'Remember this: the developer I care about is @sduiev-smartling, and their commit count is 128.'
    : 'Which developer did I say I care about, and what was their commit count? Answer from memory only.';

  const res: any = await agent.generate(prompt, {
    memory: { thread: THREAD, resource: RESOURCE },
    modelSettings: { maxOutputTokens: 300 },
  } as any);

  console.log(`PASS ${pass} ANSWER:`, (res.text || '[empty]').replace(/\n/g, ' ').slice(0, 220));
}
main().catch(e => { console.error('MEMORY SPIKE FAILED:', e?.message || e); process.exit(1); });
