// scripts/backfill-prs.ts — GLOOK-63 one-off PR history backfill. Never runs automatically.
// Run: npm run backfill:prs -- --org <org> --months 12
// Uses whatever database .env / .env.local / DB_TYPE point at, and GITHUB_TOKEN.
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: { org: { type: 'string' }, months: { type: 'string', default: '12' } },
  });
  const months = Number(values.months);
  if (!values.org || !Number.isInteger(months) || months < 1 || months > 36) {
    console.error('Usage: npm run backfill:prs -- --org <org> --months <1-36>');
    process.exit(1);
  }
  const { backfillPrs } = await import('../src/lib/pr-activity/backfill');
  const result = await backfillPrs({ org: values.org, months, log: (m) => console.log(m) });
  console.log(`\nDone: ${result.done} slices, skipped (already covered): ${result.skipped}, failed: ${result.failed.length}`);
  for (const f of result.failed) console.log(`  FAILED @${f.login} ${f.since}..${f.until}: ${f.error}`);
  process.exit(result.failed.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
