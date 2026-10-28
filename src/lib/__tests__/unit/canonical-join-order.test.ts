import fs from 'fs';
import path from 'path';

// See the comment on canonicalCommitIdsSql: the de-dupe derived table must drive the join.
const FILES = ['range.ts', 'org.ts', 'dev.ts', 'summary.ts'].map(f => path.join(__dirname, '../../report', f));

describe('canonical de-dupe joins keep a fixed join order', () => {
  it.each(FILES)('%s', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const queries = src.split('`SELECT ').slice(1).filter(q => /canonical\w+IdsSql\(/.test(q.split('`')[0] + (q.match(/\$\{canonical\w+IdsSql\([^)]*\)\}/)?.[0] ?? '')) && q.includes(') one'));
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.startsWith('/*+ JOIN_FIXED_ORDER() */')).toBe(true);
      expect(q).toMatch(/FROM \(\$\{canonical\w+IdsSql\([^)]*\)\}\) one\s+JOIN (commit_analyses ca|jira_issues ji) ON/);
    }
  });
});
