import { buildDevKeyFigures } from '@/app/report/[id]/dev/[login]/key-figures';

describe('buildDevKeyFigures', () => {
  // GLOOK finding: stripCostFields (cost-visibility.ts) DELETES cc_total_cost
  // for viewers outside the developer's team — it is absent, not zero. A
  // fabricated "$0.00" figure must never reach the chat preamble.
  it('omits the spend figure entirely when cc_total_cost is absent (stripped)', () => {
    const figures = buildDevKeyFigures({ total_commits: 10, total_prs: 2 });
    expect(figures.find(f => f.label === 'Claude Code spend')).toBeUndefined();
  });

  it('omits the spend figure when cc_total_cost is explicitly null', () => {
    const figures = buildDevKeyFigures({ cc_total_cost: null, total_commits: 10, total_prs: 2 });
    expect(figures.find(f => f.label === 'Claude Code spend')).toBeUndefined();
  });

  it('includes the formatted spend figure when cc_total_cost is present', () => {
    const figures = buildDevKeyFigures({ cc_total_cost: 4830, total_commits: 10, total_prs: 2 });
    expect(figures.find(f => f.label === 'Claude Code spend')).toEqual({
      label: 'Claude Code spend',
      value: '$48.30',
    });
  });

  it('still includes commits and PRs regardless of spend visibility', () => {
    const figures = buildDevKeyFigures({ total_commits: 10, total_prs: 2 });
    expect(figures.find(f => f.label === 'Commits')).toEqual({ label: 'Commits', value: 10 });
    expect(figures.find(f => f.label === 'PRs')).toEqual({ label: 'PRs', value: 2 });
  });

  // A genuine zero must still be distinguishable from "absent" — 0 is a real,
  // present value and should render normally, not be dropped.
  it('includes a genuine zero spend as $0.00', () => {
    const figures = buildDevKeyFigures({ cc_total_cost: 0, total_commits: 0, total_prs: 0 });
    expect(figures.find(f => f.label === 'Claude Code spend')).toEqual({
      label: 'Claude Code spend',
      value: '$0.00',
    });
  });
});
