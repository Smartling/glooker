// scripts/rebuild-canonical.ts — GLOOK-63 canonical commit/Jira tables.
// Run: npm run rebuild:canonical            (rebuild every org)
//      npm run rebuild:canonical -- --check (read-only comparison, exit 1 on drift)
// Uses whatever database .env / .env.local / DB_TYPE point at.
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  const { runCanonicalCli } = await import('../src/lib/canonical/cli');
  process.exit(await runCanonicalCli(values.check ? ['--check'] : [], (l) => console.log(l)));
}

main().catch((err) => {
  console.error('Canonical rebuild failed:', err);
  process.exit(1);
});
