/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
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

it('renders Model Mix with share and percent under full visibility', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={modelUsage} />);
  expect(screen.getByText('Model Mix')).toBeTruthy();
  expect(screen.getByText('opus')).toBeTruthy();
  expect(screen.getByText('sonnet')).toBeTruthy();
  // getAllByText, not getByText: 60% legitimately renders twice (bar segment +
  // table cell) and, in this fixture, a third time in the pre-existing "Top 20%
  // Share" tile — a coincidental numeric match since this fixture gives each
  // developer exactly one model at the same cost as their total spend.
  expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
  expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
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
  // getAllByText: 100% renders in both the bar segment and the table cell.
  expect(screen.getAllByText('100%').length).toBeGreaterThan(0); // opus is all of the visible spend
  expect(screen.queryByText('sonnet')).toBeNull();        // scope coherence
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
