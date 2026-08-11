/**
 * @jest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react';
import { SpendTab } from '@/app/report/[id]/org/page';

const baseProps = {
  reportId: 'r1',
  router: { push: jest.fn() } as any,
  report: { id: 'r1', org: 'acme', period_days: 14 } as any,
  spendWindow: null,
  skillsUsage: [
    { github_login: 'alice', product: 'cowork', skills_used: 9, skills_distinct: 8 },
    { github_login: 'bob', product: 'chat', skills_used: 0, skills_distinct: 3 },
  ],
};

const allVisible = [
  { github_login: 'alice', cc_total_cost: 600, cc_requests: 10, impact_score: 5 },
  { github_login: 'bob', cc_total_cost: 400, cc_requests: 40, impact_score: 4 },
] as any[];

const modelUsage = [
  { github_login: 'alice', model: 'opus', cost: 600, requests: 5 },
  { github_login: 'bob', model: 'sonnet', cost: 400, requests: 40 },
];

// The Model Mix section's own container: the outer bg-gray-900 panel that
// holds the section label plus the bar and table. Scoping queries to it
// avoids false matches against unrelated siblings — notably the pre-existing
// "Top 20% Share" summary tile and the Pareto "Spend Concentration" block,
// which can coincidentally render the same percentage text.
function getModelMixPanel(labelMatcher: string | RegExp): HTMLElement {
  return screen.getByText(labelMatcher).closest('div')!.parentElement as HTMLElement;
}

it('renders Model Mix with share and percent under full visibility', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={modelUsage} />);
  expect(screen.getByText('Model Mix')).toBeTruthy();
  expect(screen.getByText('opus')).toBeTruthy();
  expect(screen.getByText('sonnet')).toBeTruthy();
  const panel = getModelMixPanel('Model Mix');
  // Exactly 2: the bar segment and the table % cell for each model. A scoped
  // exact count (rather than "at least one somewhere on the page") actually
  // proves both the bar AND the table render the percentage — either one
  // going missing, or an unrelated element supplying a false positive,
  // would change this count.
  expect(within(panel).getAllByText('60%')).toHaveLength(2);
  expect(within(panel).getAllByText('40%')).toHaveLength(2);
});

it('relabels and keeps percent under partial visibility', () => {
  // bob's cost is absent => partial visibility. A composition share is still
  // valid on a well-defined subset, so % must SURVIVE (unlike the Pareto stats).
  const partialDevs = [
    { github_login: 'alice', cc_total_cost: 600, cc_requests: 10, impact_score: 5 },
    { github_login: 'bob', impact_score: 4 },
  ] as any[];
  const partialModels = [
    { github_login: 'alice', model: 'opus', cost: 600, requests: 5 },
    { github_login: 'bob', model: 'sonnet' },
  ];
  render(<SpendTab {...baseProps} developers={partialDevs} modelUsage={partialModels} />);
  expect(screen.getByText(/Your teams' model mix/i)).toBeTruthy();
  expect(screen.queryByText('Model Mix')).toBeNull();
  const panel = getModelMixPanel(/Your teams' model mix/i);
  // Exactly 2: bar segment + table cell. opus is all of the visible spend.
  expect(within(panel).getAllByText('100%')).toHaveLength(2);
  expect(within(panel).queryByText('sonnet')).toBeNull(); // scope coherence
  // The amber scope note must accompany the relabel — asserted explicitly,
  // not left implicit, since it's what tells the viewer why the section is
  // scoped down instead of showing an org-wide mix.
  expect(screen.getByText(/Cost shown for developers on your team\(s\) only/i)).toBeTruthy();
});

it('renders the compact skills line', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={modelUsage} />);
  expect(screen.getByText(/9 invocations by 2 developers/i)).toBeTruthy();
});

it('omits the Model Mix section entirely when there is no model data', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={[]} />);
  expect(screen.queryByText('Model Mix')).toBeNull();
  expect(screen.queryByText(/Your teams' model mix/i)).toBeNull();
});

it('collapses models past the top 5 into an Other bar segment, while the table keeps every model', () => {
  // 8 equal-cost models: computeModelMix sorts ties by name, so the top 5
  // (by cost, then name) are m1..m5 and the tail is m6..m8. Each model is
  // 1/8 = 12.5% of spend, so top5 = 62.5% and Other = 37.5% — comfortably
  // above the 12%-to-label threshold used elsewhere in this bar.
  const manyModels = Array.from({ length: 8 }, (_, i) => ({
    github_login: 'carol',
    model: `m${i + 1}`,
    cost: 100,
    requests: 10,
  }));
  const manyDevs = [
    { github_login: 'carol', cc_total_cost: 800, cc_requests: 80, impact_score: 5 },
  ] as any[];

  render(<SpendTab {...baseProps} developers={manyDevs} modelUsage={manyModels} />);

  // The table still lists every model individually — only the bar collapses.
  for (let i = 1; i <= 8; i++) {
    expect(screen.getByText(`m${i}`)).toBeTruthy();
  }
  expect(screen.getByText(/Other — 38%/)).toBeTruthy();

  const panel = getModelMixPanel('Model Mix');
  const bar = panel.querySelector('.h-6.bg-gray-800') as HTMLElement;
  const segmentWidths = Array.from(bar.children).map(el =>
    parseFloat((el as HTMLElement).style.width)
  );
  expect(segmentWidths).toHaveLength(6); // top 5 models + 1 Other segment
  const total = segmentWidths.reduce((sum, w) => sum + w, 0);
  expect(total).toBeCloseTo(100, 0);
});
