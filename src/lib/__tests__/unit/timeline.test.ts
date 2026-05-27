import { aggregateWeekly, weekKeyForDate } from '@/lib/report/timeline';

const MON_A = '2026-05-04T10:00:00Z';
const TUE_A = '2026-05-05T10:00:00Z';
const MON_B = '2026-05-11T10:00:00Z';

function row(opts: Partial<{ committed_at: string; pr_number: number | null; lines_added: number; lines_removed: number }> = {}) {
  return {
    commit_sha: Math.random().toString(36).slice(2),
    committed_at: opts.committed_at ?? MON_A,
    lines_added: opts.lines_added ?? 0,
    lines_removed: opts.lines_removed ?? 0,
    complexity: null,
    ai_co_authored: false, maybe_ai: false, type: null,
    github_login: 'alice',
    pr_number: 'pr_number' in opts ? opts.pr_number : null,
  };
}

describe('aggregateWeekly — prs field', () => {
  it('returns prs=0 when no rows have pr_number', () => {
    const out = aggregateWeekly([row(), row()]);
    expect(out).toHaveLength(1);
    expect(out[0].prs).toBe(0);
  });

  it('counts a single PR once even when it has multiple commits in the same week', () => {
    const out = aggregateWeekly([
      row({ pr_number: 42 }),
      row({ pr_number: 42 }),
      row({ pr_number: 42, committed_at: TUE_A }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].commits).toBe(3);
    expect(out[0].prs).toBe(1);
  });

  it('counts multiple distinct PRs in a single week', () => {
    const out = aggregateWeekly([
      row({ pr_number: 1 }),
      row({ pr_number: 2 }),
      row({ pr_number: 3 }),
    ]);
    expect(out[0].prs).toBe(3);
  });

  it('counts a PR in each week when its commits span two weeks', () => {
    const out = aggregateWeekly([
      row({ pr_number: 99, committed_at: MON_A }),
      row({ pr_number: 99, committed_at: MON_B }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].prs).toBe(1);
    expect(out[1].prs).toBe(1);
  });

  it('mixes pr_number rows and direct-push rows correctly', () => {
    const out = aggregateWeekly([
      row({ pr_number: 7 }),
      row({ pr_number: null }),
      row({ pr_number: 7 }),
      row({ pr_number: 8 }),
    ]);
    expect(out[0].commits).toBe(4);
    expect(out[0].prs).toBe(2);
  });
});

describe('aggregateWeekly — avgLinesPerPr field', () => {
  it('returns avgLinesPerPr=0 when no rows have pr_number', () => {
    const out = aggregateWeekly([
      row({ lines_added: 100, lines_removed: 50 }),
      row({ lines_added: 20, lines_removed: 0 }),
    ]);
    expect(out[0].avgLinesPerPr).toBe(0);
  });

  it('sums lines across a PR\'s commits and divides by 1', () => {
    const out = aggregateWeekly([
      row({ pr_number: 42, lines_added: 30, lines_removed: 10 }),
      row({ pr_number: 42, lines_added: 40, lines_removed: 20 }),
    ]);
    expect(out[0].prs).toBe(1);
    expect(out[0].avgLinesPerPr).toBe(100);
  });

  it('averages over distinct PRs in a week', () => {
    const out = aggregateWeekly([
      row({ pr_number: 1, lines_added: 100, lines_removed: 0 }),
      row({ pr_number: 2, lines_added: 50, lines_removed: 0 }),
    ]);
    expect(out[0].avgLinesPerPr).toBe(75);
  });

  it('excludes direct-push lines from the numerator', () => {
    const out = aggregateWeekly([
      row({ pr_number: 7, lines_added: 100, lines_removed: 0 }),
      row({ pr_number: null, lines_added: 9999, lines_removed: 0 }),
    ]);
    expect(out[0].prs).toBe(1);
    expect(out[0].avgLinesPerPr).toBe(100);
  });

  it('rounds the result to the nearest integer', () => {
    const out = aggregateWeekly([
      row({ pr_number: 1, lines_added: 10, lines_removed: 0 }),
      row({ pr_number: 2, lines_added: 10, lines_removed: 0 }),
      row({ pr_number: 3, lines_added: 11, lines_removed: 0 }),
    ]);
    expect(out[0].avgLinesPerPr).toBe(10);
  });

  it('excludes outlier PRs above P95 from the average', () => {
    const rows: any[] = [];
    for (let i = 1; i <= 20; i++) {
      rows.push(row({ pr_number: i, lines_added: 50, lines_removed: 0 }));
    }
    // One huge PR — above P95 of the 21-PR population, should be excluded from the avg.
    rows.push(row({ pr_number: 999, lines_added: 10000, lines_removed: 0 }));
    const out = aggregateWeekly(rows);
    expect(out[0].prs).toBe(21);
    expect(out[0].avgLinesPerPr).toBe(50);
  });
});
