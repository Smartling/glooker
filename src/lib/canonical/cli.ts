import { checkCanonical, rebuildCanonical, RebuildRunningError } from '@/lib/canonical/rebuild';

/** Testable core of scripts/rebuild-canonical.ts. Returns the process exit code. */
export async function runCanonicalCli(argv: string[], out: (line: string) => void): Promise<number> {
  if (argv.includes('--check')) {
    const orgs = await checkCanonical();
    let clean = true;
    for (const o of orgs) {
      out(`${o.org}: ${o.builtAt ?? 'not built'}`);
      for (const [label, t] of [['commits', o.commits], ['jira   ', o.jira]] as const) {
        out(`  ${label} stored=${t.stored} expected=${t.expected} differ=${t.differ}`);
        if (t.differ > 0) out(`    e.g. ${t.examples.join(', ')}`);
        if (t.differ > 0) clean = false;
      }
      if (!o.builtAt) clean = false;
    }
    return clean ? 0 : 1;
  }
  try {
    const results = await rebuildCanonical();
    let failed = false;
    for (const r of results) {
      if (r.ok) out(`${r.org}: ok (${r.commitRows} commits, ${r.jiraRows} issues, ${r.durationMs}ms)`);
      else { out(`${r.org}: FAILED ${r.error}`); failed = true; }
    }
    return failed ? 2 : 0;
  } catch (err) {
    if (err instanceof RebuildRunningError) { out(err.message); return 3; }
    throw err;
  }
}
