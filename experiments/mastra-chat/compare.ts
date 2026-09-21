/**
 * Phase 1 harness: control arm vs Mastra arm, same tools, same model, same route.
 * Questions 2-5 need genuine multi-step reasoning — the thing today's chat cannot do.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { runControlAgent } from './control-agent';
import { runMastraAgent } from './mastra-agent';
import type { AgentRun } from './control-agent';
import { writeFileSync, appendFileSync } from 'fs';

const OUT = 'experiments/mastra-chat/PHASE1-COMPARISON.md';
/** One slow question must not stall the whole run. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ]);
}
const say = (line: string) => { process.stdout.write(line + '\n'); appendFileSync(OUT, line + '\n'); };

const ORG = process.env.EXPERIMENT_ORG || 'Smartling';

const SYSTEM = `You are Glooker Assistant — a data analyst for GitHub org developer analytics.
Always use the tools to get data; never guess numbers.
Be concise: answer first, then the supporting data.
Use @login format for developers. Round to 1 decimal place.
The chat window is narrow (~45 chars): max 3-4 short columns in tables, prefer bullets.`;

const QUESTIONS = [
  'Who are the top 5 developers by impact score?',
  'Who has the most commits, and what percentage of the org total is that?',
  'Is the top developer by commits the same person as the top developer by impact score? Answer yes or no and name both.',
  'Find the single most complex commit from the last 90 days, say who wrote it, then tell me how many commits that person has in total.',
  'How many developers are in the org, and how does the top developer\'s commit count compare to the org average?',
];

function row(label: string, r: AgentRun | null, err?: string) {
  if (!r) return `  ${label.padEnd(8)} FAILED: ${err}`;
  return `  ${label.padEnd(8)} steps=${r.steps} tools=${r.toolCalls.length} ` +
         `tok=${r.inputTokens}/${r.outputTokens} ${(r.ms / 1000).toFixed(1)}s`;
}

async function main() {
  writeFileSync(OUT, `# Phase 1 comparison — org=${ORG}\n`);

  for (const [i, q] of QUESTIONS.entries()) {
    process.stdout.write(`\n=== Q${i + 1}: ${q}\n`);
    say(`\n## Q${i + 1}. ${q}\n`);

    let ctrl: AgentRun | null = null, mast: AgentRun | null = null;
    let ctrlErr = '', mastErr = '';
    try { ctrl = await withTimeout(runControlAgent(q, ORG, SYSTEM), 150_000, 'control'); }
    catch (e: any) { ctrlErr = e?.message ?? String(e); }
    try { mast = await withTimeout(runMastraAgent(q, ORG, SYSTEM), 150_000, 'mastra'); }
    catch (e: any) { mastErr = e?.message ?? String(e); }

    say(row('CONTROL', ctrl, ctrlErr));
    say(row('MASTRA', mast, mastErr));

    for (const [label, r, err] of [['CONTROL', ctrl, ctrlErr], ['MASTRA', mast, mastErr]] as const) {
      say(`### ${label}`);
      if (!r) { say(`FAILED: ${err}\n`); continue; }
      say(`steps=${r.steps} tools=${r.toolCalls.length} tokens=${r.inputTokens}/${r.outputTokens} ${(r.ms/1000).toFixed(1)}s`);
      say('```\n' + r.toolCalls.join('\n') + '\n```');
      say(r.answer + '\n');
    }
  }

  say('\nDONE');
}
main().catch(e => { console.error('harness failed:', e?.message || e); process.exit(1); });
