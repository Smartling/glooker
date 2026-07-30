import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('GLOOK-27 cost leak-surface guards', () => {
  it('CSV/Sheets export builds no cost columns', () => {
    const src = read('src/app/report/[id]/team/page.tsx');
    // Guard both leak paths: (1) a cost field pulled into the export body
    // (rows are built from `d.<field>` after the `headers` declaration), and
    // (2) a cost-labelled column added to a `headers = [...]` array literal.
    expect(src).not.toMatch(/headers[\s\S]*(cc_total_cost|cc_requests)/);
    for (const m of src.matchAll(/headers\s*=\s*\[[^\]]*\]/g)) {
      expect(m[0]).not.toMatch(/spend|cost/i);
    }
  });

  it('team-pulse data layer selects no cost fields', () => {
    const src = read('src/lib/team-pulse/data.ts');
    expect(src).not.toMatch(/cc_total_cost|cc_requests|cc_period/);
  });
});
