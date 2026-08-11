/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ClaudeCodeUsageCard } from '@/app/report/[id]/dev/[login]/usage-card';

it('renders spend, requests, skills invoked and both lists', () => {
  render(<ClaudeCodeUsageCard
    costCents={12345} requests={42} skillsUsed={12}
    skills={[{ product: 'cowork', skills_used: 12, skills_distinct: 4 }]}
    models={[{ model: 'claude-sonnet-5', cost: 500, requests: 20 }]}
  />);
  expect(screen.getByText('$123.45')).toBeTruthy();
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  expect(screen.getByText('cowork')).toBeTruthy();
  expect(screen.getByText(/12 used/)).toBeTruthy();
  expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.getByText(/\$5\.00/)).toBeTruthy();
});

it('renders a model with cost and requests stripped without printing $undefined or NaN', () => {
  render(<ClaudeCodeUsageCard
    skills={[]} models={[{ model: 'claude-sonnet-5' }]}
  />);
  expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.queryByText(/undefined|NaN|\$/)).toBeNull();
});

it('shows an em dash for an absent spend and requests', () => {
  render(<ClaudeCodeUsageCard
    skillsUsed={0} skills={[]} models={[{ model: 'm1' }]}
  />);
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
});

it('renders nothing when no dimension has data', () => {
  const { container } = render(<ClaudeCodeUsageCard skills={[]} models={[]} />);
  expect(container.firstChild).toBeNull();
});

it('renders when only skills have data (zero spend)', () => {
  render(<ClaudeCodeUsageCard
    costCents={0} skills={[{ product: 'chat', skills_used: 0, skills_distinct: 3 }]} models={[]}
  />);
  expect(screen.getByText('chat')).toBeTruthy();
  expect(screen.getByText(/3 distinct/)).toBeTruthy();
});

it('lays out model rows on a fixed 3-column grid so the bar and value stay aligned regardless of content, including a row with no cost', () => {
  render(<ClaudeCodeUsageCard
    skills={[]}
    models={[
      { model: 'claude-opus-4', cost: 49854, requests: 1672 },
      { model: 'claude-haiku-4', requests: 364 },
    ]}
  />);
  const rowWithCost = screen.getByText('claude-opus-4').parentElement!;
  const rowWithoutCost = screen.getByText('claude-haiku-4').parentElement!;
  // Fixed grid (not flex) is what keeps the bar's x-position constant across
  // rows regardless of how wide each row's value text is.
  expect(rowWithCost.className).toMatch(/\bgrid\b/);
  expect(rowWithCost.className).toContain('grid-cols-');
  // Same column template for both shapes — the row with no cost must not
  // collapse to fewer cells and let the value slide into the bar's column.
  expect(rowWithoutCost.className).toBe(rowWithCost.className);
  expect(rowWithCost.children).toHaveLength(3);
  expect(rowWithoutCost.children).toHaveLength(3);
  expect(screen.getByText('claude-haiku-4')).toBeTruthy();
  expect(screen.getByText(/364 req/)).toBeTruthy();
});
