import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('GLOOK-27 cost leak-surface guards', () => {
  it('CSV/Sheets export builds no cost columns', () => {
    const src = read('src/app/report/[id]/team/page.tsx');
    // Robust against renaming the header local or relabelling a column: you
    // cannot export a developer's cost without referencing one of the cost field
    // identifiers, so assert none appear anywhere in the export page.
    expect(src).not.toMatch(/cc_total_cost|cc_requests|cc_period/);
  });

  it('team-pulse data layer selects no cost fields', () => {
    const src = read('src/lib/team-pulse/data.ts');
    expect(src).not.toMatch(/cc_total_cost|cc_requests|cc_period/);
  });
});
